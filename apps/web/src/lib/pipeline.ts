/**
 * 识别流水线：preprocess → segment → classify → postprocess
 *
 * preprocess + segment 在 Web Worker（classic）里执行，
 * ONNX 推理在主线程（异步，不阻塞 UI）。
 *
 * 后处理优化：
 * - 复用同一个 canvas 渲染所有 patch（不再每个 patch 创建新 DOM 元素）
 * - 文本结果尽快通过 onPartialResult 抛出，让 UI 先把识别字符串显示出来，
 *   然后调试图像（patchImages / preprocessedImageUrl / annotatedImageUrl）
 *   通过 onDebugReady 异步补送，避免「卡在拼装结果」。
 */

import type {
  InputImage,
  LoadedPack,
  RecognitionResult,
  RecognizedGlyph,
} from "~/types/pack";
import type { SegmentConfig } from "./cv/segment";
import { autoSegmentConfigForImage } from "./cv/autoSegmentConfig";
import { warmupPipeline as warmupCv, preprocessAndSegment } from "./cv/loader";
import {
  grayPixelsToDataUrl,
  annotateOriginal,
  beginPatchRendering,
  renderPatch,
  endPatchRendering,
} from "./cv/debug";
import { renderTranslatedImage } from "./cv/inpaint";
import { predictBatch, type PatchPrediction } from "./inference/predict";
import { matchTemplates } from "./inference/template-match";

export type PipelineStage =
  | "loading-cv"
  | "preprocess"
  | "segment"
  | "loading-model"
  | "classify"
  | "postprocess";

function yieldToUi() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

const log =
  typeof console !== "undefined"
    ? console.log.bind(console, "[pipeline]")
    : () => {};

export function warmupPipeline() {
  warmupCv();
}

export interface RecognizeCallbacks {
  onProgress?: (stage: PipelineStage) => void;
  /** 调试图像（patches / preprocessed / annotated）就绪后回调，可能比 recognize 的 await 晚 */
  onDebugReady?: (debug: NonNullable<RecognitionResult["debug"]>) => void;
}

/** 归一化 ROI（[0,1]，相对原图），未提供时识别整图 */
export interface RoiRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function recognize(
  input: InputImage,
  pack: LoadedPack,
  callbacks: RecognizeCallbacks | ((stage: PipelineStage) => void) | undefined,
  segmentConfig?: Partial<SegmentConfig>,
  roi?: RoiRect | null,
  manualSplitXs?: number[],
): Promise<RecognitionResult> {
  // 兼容旧的 onProgress 单函数签名
  const cb: RecognizeCallbacks =
    typeof callbacks === "function"
      ? { onProgress: callbacks }
      : (callbacks ?? {});

  const tStart = performance.now();
  log("start, config=", segmentConfig, "roi=", roi);

  cb.onProgress?.("loading-cv");
  await yieldToUi();

  // ROI 裁剪：整屏截图里文字只占一小块时，先裁出该区域再识别。
  // 裁出的 bitmap 用于 preprocess/segment；识别框的坐标最后再加回 ROI 偏移，
  // 以便在原始整图上正确标注。
  let workBitmap: ImageBitmap = input.bitmap;
  let roiOffset = { x: 0, y: 0 };
  let croppedBitmap: ImageBitmap | null = null;
  if (roi && roi.w > 0 && roi.h > 0) {
    const bw = input.bitmap.width;
    const bh = input.bitmap.height;
    const sx = Math.max(0, Math.round(roi.x * bw));
    const sy = Math.max(0, Math.round(roi.y * bh));
    const sw = Math.min(bw - sx, Math.round(roi.w * bw));
    const sh = Math.min(bh - sy, Math.round(roi.h * bh));
    if (sw > 2 && sh > 2) {
      croppedBitmap = await createImageBitmap(input.bitmap, sx, sy, sw, sh);
      workBitmap = croppedBitmap;
      roiOffset = { x: sx, y: sy };
      log("cropped ROI", { sx, sy, sw, sh });
    }
  }

  cb.onProgress?.("preprocess");
  await yieldToUi();
  const tP0 = performance.now();
  log("sending to worker...");
  const segConfig = autoSegmentConfigForImage(workBitmap.width, workBitmap.height, segmentConfig);
  const { pre, seg } = await preprocessAndSegment(workBitmap, segConfig, manualSplitXs);
  const tS = performance.now();
  log(
    "worker done in",
    (tS - tP0).toFixed(0),
    "ms, glyphs=",
    seg.glyphs.length,
    "stats=",
    seg.debugStats,
  );

  let predictions: PatchPrediction[] = [];
  if (seg.glyphs.length > 0) {
    // 不再按 bbox 尺寸过滤标点：标点/数字现在是模型的真实类别，由模型决定是否 reject。
    const patches = seg.glyphs.map(
      (g: any) => new Uint8ClampedArray(g.patch),
    );

    cb.onProgress?.("loading-model");
    await yieldToUi();
    cb.onProgress?.("classify");
    await yieldToUi();
    log("classify", patches.length, "patches via ONNX CNN...");
    try {
      predictions = await predictBatch(patches, pack);
    } catch (err) {
      // ONNX 失败兜底到模板匹配（仅字母可靠）
      log("ONNX predict failed, fallback to NCC template matching:", err);
      predictions = await matchTemplates(patches, pack);
    }
    log("classify done");
  }
  const tC = performance.now();

  cb.onProgress?.("postprocess");
  await yieldToUi();
  log("postprocessing...");
  const { text, recognizedGlyphs } = postprocess(seg.glyphs, predictions, pack);
  // 把识别框坐标从 ROI 局部坐标加回偏移，映射回原始整图
  if (roiOffset.x !== 0 || roiOffset.y !== 0) {
    for (const g of recognizedGlyphs) {
      g.bbox = [g.bbox[0] + roiOffset.x, g.bbox[1] + roiOffset.y, g.bbox[2], g.bbox[3]];
    }
  }
  if (croppedBitmap) croppedBitmap.close();
  const tF = performance.now();
  log("postprocess done");

  const avg =
    recognizedGlyphs.length > 0
      ? recognizedGlyphs.reduce((s, g) => s + g.confidence, 0) /
        recognizedGlyphs.length
      : 0;

  const baseResult: RecognitionResult = {
    text,
    glyphs: recognizedGlyphs,
    averageConfidence: avg,
    elapsedMs: performance.now() - tStart,
    stageTimings: {
      preprocess: tS - tP0,
      segment: 0,
      classify: tC - tS,
      postprocess: tF - tC,
    },
    debug: {
      rejectedCount: seg.rejectedCount,
      debugStats: seg.debugStats,
    },
  };

  // 调试图像异步渲染，避免阻塞主结果返回
  void renderDebugImagesAsync(
    input,
    pre,
    seg,
    recognizedGlyphs,
    predictions,
    cb.onDebugReady,
  );

  log("finished base in", (performance.now() - tStart).toFixed(0), "ms");
  return baseResult;
}

async function renderDebugImagesAsync(
  input: InputImage,
  pre: { working: Uint8Array; width: number; height: number },
  seg: { glyphs: any[]; rejectedCount: number; debugStats?: any },
  recognizedGlyphs: RecognizedGlyph[],
  predictions: PatchPrediction[],
  onReady?: (debug: NonNullable<RecognitionResult["debug"]>) => void,
): Promise<void> {
  if (!onReady) return;
  const t0 = performance.now();
  await yieldToUi();
  log("debug: preprocessedImageUrl ...");
  const preprocessedImageUrl = grayPixelsToDataUrl(
    pre.working,
    pre.width,
    pre.height,
  );

  await yieldToUi();
  log("debug: patches (count=", seg.glyphs.length, ") ...");
  const patchImages: string[] = [];
  beginPatchRendering(64, 64);
  try {
    for (let i = 0; i < seg.glyphs.length; i++) {
      patchImages.push(
        renderPatch(new Uint8ClampedArray(seg.glyphs[i]!.patch), 64, 64),
      );
      // 每 10 个 yield 一次，让 UI 有机会刷新
      if (i % 10 === 9) await yieldToUi();
    }
  } finally {
    endPatchRendering();
  }

  await yieldToUi();
  log("debug: annotateOriginal ...");
  const annotatedImageUrl = annotateOriginal(input.bitmap, recognizedGlyphs);

  await yieldToUi();
  log("debug: renderTranslatedImage ...");
  const translatedImageUrl =
    recognizedGlyphs.length > 0
      ? renderTranslatedImage(input.bitmap, recognizedGlyphs)
      : undefined;
  log("debug: done in", (performance.now() - t0).toFixed(0), "ms");

  const patchLabels = predictions.map((p) => ({
    letter: p.isReject ? "×" : p.letter,
    confidence: p.confidence,
    isReject: p.isReject,
  }));

  onReady({
    preprocessedImageUrl,
    annotatedImageUrl,
    translatedImageUrl,
    patchImages,
    patchLabels,
    rejectedCount: seg.rejectedCount,
    debugStats: seg.debugStats,
  });
}

function postprocess(
  glyphs: any[],
  predictions: PatchPrediction[],
  pack: LoadedPack,
) {
  const parts: string[] = [];
  const recognizedGlyphs: RecognizedGlyph[] = [];
  const rejectRender = pack.mapping.reject_class?.render ?? "?";
  let currentRow = -1;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    const p = predictions[i];
    if (!p) continue;
    if (p.isReject) continue;
    if (g.rowIndex !== currentRow) {
      if (currentRow !== -1) parts.push("\n");
      currentRow = g.rowIndex;
    } else if (g.spaceBefore) {
      parts.push(" ");
    }
    const renderLetter = p.belowThreshold ? rejectRender : p.letter;
    parts.push(renderLetter);
    recognizedGlyphs.push({
      bbox: g.bboxOriginal,
      letter: renderLetter,
      confidence: p.confidence,
      alternatives: p.alternatives,
    });
  }
  const text = parts.join("");
  return { text, recognizedGlyphs };
}
