/**
 * NCC（归一化互相关）模板匹配器：用 26 个参考 glyph 模板直接和 patch 做像素比较。
 *
 * 对于固定字符集的自创字体，模板匹配比 CNN 更可靠——
 * 不存在训练数据与真实 patch 之间的域差距。
 *
 * 匹配前会对 patch 和模板统一做「前景归一化」——
 * 裁剪前景 bbox → 等比缩放到标准区域 → 居中到 64×64 画布，
 * 保证不管原始 padding 多少，字形在同一尺度下比较。
 */

import type { LoadedPack } from "~/types/pack";
import type { PatchPrediction } from "./predict";

const TEMPLATE_SIZE = 64;
const TEMPLATE_PIXELS = TEMPLATE_SIZE * TEMPLATE_SIZE;
const TOP_K = 3;

/** 前景归一化后字形占画布的比例（留一定 margin 防止贴边） */
const GLYPH_FILL = 0.82;

/** 前景判定阈值：< 此值视为前景（黑色笔画） */
const FG_THRESH = 180;

interface TemplateData {
  normed: Float32Array[];
  labels: string[];
}

const templateCache = new Map<string, TemplateData>();

async function loadTemplates(pack: LoadedPack): Promise<TemplateData> {
  const cached = templateCache.get(pack.meta.id);
  if (cached) return cached;

  const templatesFile = (pack.meta.files as Record<string, string>).templates;
  if (!templatesFile) throw new Error("Font pack missing templates.bin");

  const url = `${pack.baseUrl}/${templatesFile}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load templates: ${resp.status}`);
  const raw = new Uint8Array(await resp.arrayBuffer());

  const letters = pack.mapping.output_index_to_letter.filter((l) => l !== "");
  const numLetters = letters.length;
  if (raw.length !== numLetters * TEMPLATE_PIXELS) {
    throw new Error(`templates.bin size mismatch: ${raw.length} vs ${numLetters * TEMPLATE_PIXELS}`);
  }

  const normed: Float32Array[] = [];
  for (let i = 0; i < numLetters; i++) {
    const slice = raw.subarray(i * TEMPLATE_PIXELS, (i + 1) * TEMPLATE_PIXELS);
    const aligned = alignForeground(slice, TEMPLATE_SIZE, TEMPLATE_SIZE);
    normed.push(normalizeVec(aligned));
  }

  const data: TemplateData = { normed, labels: letters };
  templateCache.set(pack.meta.id, data);
  return data;
}

/**
 * 前景归一化：找到前景 bbox → 裁剪 → 等比缩放到标准区域 → 居中到白色 canvas。
 * 保证不同来源（模板 vs pipeline patch）的字形在 64×64 里占同一比例。
 */
function alignForeground(
  pixels: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number
): Uint8ClampedArray {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x]! < FG_THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    return new Uint8ClampedArray(TEMPLATE_PIXELS).fill(255);
  }

  const fgW = maxX - minX + 1;
  const fgH = maxY - minY + 1;

  const targetSide = Math.round(TEMPLATE_SIZE * GLYPH_FILL);
  const scale = Math.min(targetSide / fgW, targetSide / fgH);
  const newW = Math.max(1, Math.round(fgW * scale));
  const newH = Math.max(1, Math.round(fgH * scale));

  // 双线性插值缩放（保留灰度渐变，对低分辨率更鲁棒）
  const scaled = new Uint8ClampedArray(newW * newH);
  for (let dy = 0; dy < newH; dy++) {
    const srcYf = dy / scale;
    const srcY0 = Math.min(Math.floor(srcYf), fgH - 1);
    const srcY1 = Math.min(srcY0 + 1, fgH - 1);
    const fy = srcYf - srcY0;
    for (let dx = 0; dx < newW; dx++) {
      const srcXf = dx / scale;
      const srcX0 = Math.min(Math.floor(srcXf), fgW - 1);
      const srcX1 = Math.min(srcX0 + 1, fgW - 1);
      const fx = srcXf - srcX0;
      const p00 = pixels[(minY + srcY0) * w + (minX + srcX0)]!;
      const p10 = pixels[(minY + srcY0) * w + (minX + srcX1)]!;
      const p01 = pixels[(minY + srcY1) * w + (minX + srcX0)]!;
      const p11 = pixels[(minY + srcY1) * w + (minX + srcX1)]!;
      scaled[dy * newW + dx] = Math.round(
        p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
        p01 * (1 - fx) * fy + p11 * fx * fy
      );
    }
  }

  // 居中贴到 64×64 白色画布
  const canvas = new Uint8ClampedArray(TEMPLATE_PIXELS).fill(255);
  const offX = Math.floor((TEMPLATE_SIZE - newW) / 2);
  const offY = Math.floor((TEMPLATE_SIZE - newH) / 2);
  for (let dy = 0; dy < newH; dy++) {
    for (let dx = 0; dx < newW; dx++) {
      canvas[(offY + dy) * TEMPLATE_SIZE + (offX + dx)] = scaled[dy * newW + dx]!;
    }
  }
  return canvas;
}

/** 去均值 + 除以 L2 范数 → NCC 变成简单的点积 */
function normalizeVec(raw: Uint8ClampedArray): Float32Array {
  const n = raw.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += raw[i]!;
  const mean = sum / n;

  const out = new Float32Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = raw[i]! - mean;
    out[i] = d;
    sq += d * d;
  }
  const norm = Math.sqrt(sq);
  if (norm > 1e-8) {
    for (let i = 0; i < n; i++) out[i] /= norm;
  }
  return out;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/**
 * 双条件 reject 策略：
 * 1. NCC 得分极低 → 肯定不是字母
 * 2. NCC 得分偏低 + 第一名与第二名的分差极小 → 标点/噪点（无法确定是哪个字母）
 *
 * 逗号实测：best=O(0.473), 2nd=G(0.457), gap=0.016 → 被条件 1 拦住
 * 正常字母最低实测：P(0.695), gap>0.10 → 安全通过
 */
const HARD_REJECT = 0.50;
const SOFT_REJECT = 0.62;
const MIN_SCORE_GAP = 0.08;

export async function matchTemplates(
  patches: Uint8ClampedArray[],
  pack: LoadedPack
): Promise<PatchPrediction[]> {
  if (patches.length === 0) return [];

  const tmpl = await loadTemplates(pack);
  const numTemplates = tmpl.normed.length;

  const out: PatchPrediction[] = [];
  for (let pi = 0; pi < patches.length; pi++) {
    const aligned = alignForeground(patches[pi]!, TEMPLATE_SIZE, TEMPLATE_SIZE);
    const patchNormed = normalizeVec(aligned);

    const scores: Array<{ idx: number; score: number }> = [];
    for (let ti = 0; ti < numTemplates; ti++) {
      scores.push({ idx: ti, score: dotProduct(patchNormed, tmpl.normed[ti]!) });
    }
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0]!;
    const secondBest = scores[1]?.score ?? 0;
    const gap = best.score - secondBest;
    const isReject = best.score < HARD_REJECT
      || (best.score < SOFT_REJECT && gap < MIN_SCORE_GAP);
    const confidence = Math.max(0, Math.min(1, (best.score + 1) / 2));

    const bestLabel = tmpl.labels[best.idx] ?? "?";
    const secondLabel = tmpl.labels[scores[1]?.idx ?? 0] ?? "?";
    console.log(
      `[ncc] patch ${pi}: best=${bestLabel}(${best.score.toFixed(3)}) 2nd=${secondLabel}(${secondBest.toFixed(3)})${isReject ? " REJECT" : ""}`
    );

    const alts = scores.slice(1, TOP_K).map((s) => ({
      letter: tmpl.labels[s.idx] ?? "?",
      confidence: Math.max(0, Math.min(1, (s.score + 1) / 2)),
    }));

    out.push({
      letter: isReject ? "" : bestLabel,
      confidence,
      alternatives: alts,
      isReject,
      belowThreshold: false,
    });
  }

  return out;
}
