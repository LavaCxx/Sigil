/**
 * 主线程使用的调试可视化工具。
 *
 * 这些函数依赖 document/HTMLCanvasElement，**不能在 Worker 中调用**。
 * Worker 只负责返回原始像素数据 + 检测框，由 client.ts 在主线程上落到 canvas。
 */

import type { RecognizedGlyph } from "~/types/pack";

/** 把灰度 Mat 转为 dataURL */
export function grayMatToDataUrl(
  mat: { data: Uint8Array },
  width: number,
  height: number
): string {
  if (typeof document === "undefined") return "";
  const src = new Uint8Array(mat.data.buffer, mat.data.byteOffset, width * height);
  return grayPixelsToDataUrl(src, width, height);
}

/** 把 worker 返回的灰度 Uint8Array 直接渲染为 dataURL */
export function grayPixelsToDataUrl(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = ctx.createImageData(width, height);
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]!;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// ---- 复用 canvas 的批量 patch 渲染 ---------------------------------------
// 每次识别可能有 50+ patch，逐个 createElement("canvas") 会让主线程很慢。
// 这里在 begin → repeated renderPatch → end 期间复用同一个 canvas。

let sharedPatchCanvas: HTMLCanvasElement | null = null;
let sharedPatchCtx: CanvasRenderingContext2D | null = null;
let sharedPatchImageData: ImageData | null = null;

/** 在开始批量渲染前调用，会准备 canvas + ImageData 缓冲 */
export function beginPatchRendering(width: number, height: number): void {
  if (typeof document === "undefined") return;
  if (!sharedPatchCanvas || sharedPatchCanvas.width !== width || sharedPatchCanvas.height !== height) {
    sharedPatchCanvas = document.createElement("canvas");
    sharedPatchCanvas.width = width;
    sharedPatchCanvas.height = height;
    sharedPatchCtx = sharedPatchCanvas.getContext("2d");
    sharedPatchImageData = sharedPatchCtx?.createImageData(width, height) ?? null;
  }
}

/** 在 begin/end 之间调用，渲染单个 patch 到 dataURL */
export function renderPatch(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): string {
  if (!sharedPatchCanvas || !sharedPatchCtx || !sharedPatchImageData) {
    return grayPixelsToDataUrl(pixels, width, height);
  }
  const img = sharedPatchImageData;
  const data = img.data;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]!;
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  sharedPatchCtx.putImageData(img, 0, 0);
  return sharedPatchCanvas.toDataURL("image/png");
}

/** 批量渲染结束后调用，让 GC 释放 canvas（也可以保留，下次直接复用） */
export function endPatchRendering(): void {
  // 保留 canvas 引用，下次还能直接复用；只有维度变化时才重建。
}

/** 把原始 ImageBitmap 拷贝到 canvas，叠加检测框 + 识别字母，返回 dataURL */
export function annotateOriginal(
  bitmap: ImageBitmap,
  glyphs: RecognizedGlyph[]
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0);

  ctx.lineWidth = Math.max(1, Math.round(Math.min(bitmap.width, bitmap.height) / 400));
  ctx.font = `${Math.max(12, Math.round(bitmap.height / 50))}px ui-monospace, monospace`;
  ctx.textBaseline = "top";

  for (const g of glyphs) {
    const [x, y, w, h] = g.bbox;
    const conf = g.confidence;
    const color = conf >= 0.9 ? "#a6e3a1" : conf >= 0.7 ? "#f9e2af" : "#f38ba8";
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    if (g.letter) {
      const label = g.letter;
      const padding = 2;
      const labelW = ctx.measureText(label).width + padding * 2;
      const labelH = parseInt(ctx.font, 10) + padding * 2;
      ctx.fillStyle = "rgba(30,30,46,0.85)";
      ctx.fillRect(x, Math.max(0, y - labelH), labelW, labelH);
      ctx.fillStyle = color;
      ctx.fillText(label, x + padding, Math.max(0, y - labelH) + padding);
    }
  }

  return canvas.toDataURL("image/png");
}
