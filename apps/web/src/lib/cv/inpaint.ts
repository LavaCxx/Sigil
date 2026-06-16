/**
 * 图像翻译渲染：在原图上用背景色覆盖原始字形，再叠加英文字母。
 *
 * 类似拍照翻译软件的效果：
 *   1. 按 y 中心聚类成行，统一每行的字号和基线
 *   2. 对每个 glyph bbox，采样边界像素估算局部背景色
 *   3. 用背景色填充 bbox 区域（含微扩展消除锯齿残影）
 *   4. 在统一基线上绘制英文字母
 */

import type { RecognizedGlyph } from "~/types/pack";

export interface InpaintOptions {
  /** bbox 外扩比例（覆盖原文时留的边距），默认 0.12 */
  bleedRatio?: number;
  /** 字体大小占行高的比例，默认 0.75 */
  fontRatio?: number;
  /** 字体族，默认 sans-serif */
  fontFamily?: string;
}

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 一行内的统一渲染参数 */
interface RowLayout {
  fontSize: number;
  /** 行中线 y 坐标（textBaseline="middle" 用） */
  centerY: number;
  /** 本行的背景色（取行内所有 glyph 背景的中位色） */
  textColor: string;
  glyphs: RecognizedGlyph[];
}

// ─── 工具函数 ───────────────────────────────────────────────────────────

function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length & 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 沿 bbox 外围一圈采样像素，取各通道中位数作为局部背景色。
 */
function estimateBackground(
  imageData: ImageData,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): RGBA {
  const { data, width, height } = imageData;
  const margin = Math.max(2, Math.round(bh * 0.08));

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const x0 = Math.max(0, bx - margin);
  const y0 = Math.max(0, by - margin);
  const x1 = Math.min(width - 1, bx + bw + margin);
  const y1 = Math.min(height - 1, by + bh + margin);

  const sample = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const idx = (py * width + px) * 4;
    rs.push(data[idx]!);
    gs.push(data[idx + 1]!);
    bs.push(data[idx + 2]!);
  };

  for (let x = x0; x <= x1; x += 2) {
    for (let dy = 0; dy < margin; dy++) {
      sample(x, y0 + dy);
      sample(x, y1 - dy);
    }
  }
  for (let y = y0; y <= y1; y += 2) {
    for (let dx = 0; dx < margin; dx++) {
      sample(x0 + dx, y);
      sample(x1 - dx, y);
    }
  }

  if (rs.length === 0) return { r: 255, g: 255, b: 255, a: 255 };
  return { r: medianOf(rs), g: medianOf(gs), b: medianOf(bs), a: 255 };
}

function contrastColor(bg: RGBA): string {
  const luma = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  return luma > 128 ? "#1e1e2e" : "#f5f5f5";
}

// ─── 行聚类 ─────────────────────────────────────────────────────────────

/**
 * 按 y 中心将 glyph 聚类为行。
 *
 * 算法：按 yCenter 排序后，相邻 glyph 的 yCenter 差距若超过
 * 全局中位字符高度的一定比例，就切到下一行。
 */
function groupIntoRows(glyphs: RecognizedGlyph[]): RecognizedGlyph[][] {
  if (glyphs.length === 0) return [];

  const valid = glyphs.filter((g) => g.letter && g.letter !== "?");
  if (valid.length === 0) return [];

  const globalMedianH = medianOf(valid.map((g) => g.bbox[3]));
  const rowGapThreshold = globalMedianH * 0.5;

  const sorted = [...valid].sort((a, b) => {
    const aY = a.bbox[1] + a.bbox[3] / 2;
    const bY = b.bbox[1] + b.bbox[3] / 2;
    return aY - bY;
  });

  const rows: RecognizedGlyph[][] = [];
  let currentRow: RecognizedGlyph[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const prevCY = prev.bbox[1] + prev.bbox[3] / 2;
    const curCY = cur.bbox[1] + cur.bbox[3] / 2;

    if (Math.abs(curCY - prevCY) > rowGapThreshold) {
      rows.push(currentRow);
      currentRow = [];
    }
    currentRow.push(cur);
  }
  rows.push(currentRow);

  // 每行内按 x 排序
  for (const row of rows) {
    row.sort((a, b) => a.bbox[0] - b.bbox[0]);
  }
  return rows;
}

/**
 * 为每行计算统一的字号、基线和文字颜色。
 */
function computeRowLayouts(
  rows: RecognizedGlyph[][],
  imageData: ImageData,
  fontRatio: number,
): RowLayout[] {
  return rows.map((glyphs) => {
    const heights = glyphs.map((g) => g.bbox[3]);
    const tops = glyphs.map((g) => g.bbox[1]);
    const bottoms = glyphs.map((g) => g.bbox[1] + g.bbox[3]);

    // 用中位 top/bottom 定义行的统一边界，抗噪
    const rowTop = medianOf(tops);
    const rowBottom = medianOf(bottoms);
    const rowHeight = rowBottom - rowTop;

    const fontSize = Math.max(10, Math.round(rowHeight * fontRatio));
    const centerY = (rowTop + rowBottom) / 2;

    // 行级背景色：取中间那个 glyph 的背景来决定文字颜色
    const midGlyph = glyphs[glyphs.length >> 1]!;
    const midBg = estimateBackground(
      imageData,
      midGlyph.bbox[0], midGlyph.bbox[1], midGlyph.bbox[2], midGlyph.bbox[3],
    );
    const textColor = contrastColor(midBg);

    return { fontSize, centerY, textColor, glyphs };
  });
}

// ─── 核心渲染 ───────────────────────────────────────────────────────────

function paintTranslatedGlyphs(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  canvasW: number,
  canvasH: number,
  glyphs: RecognizedGlyph[],
  options: Required<InpaintOptions>,
): void {
  const { bleedRatio, fontRatio, fontFamily } = options;
  const rows = groupIntoRows(glyphs);
  const layouts = computeRowLayouts(rows, imageData, fontRatio);

  // Pass 1: 用背景色擦除所有原始字形
  for (const layout of layouts) {
    for (const glyph of layout.glyphs) {
      const [bx, by, bw, bh] = glyph.bbox;
      const bg = estimateBackground(imageData, bx, by, bw, bh);
      const bleed = Math.max(1, Math.round(bh * bleedRatio));
      const fx = Math.max(0, bx - bleed);
      const fy = Math.max(0, by - bleed);
      const fw = Math.min(canvasW - fx, bw + bleed * 2);
      const fh = Math.min(canvasH - fy, bh + bleed * 2);
      ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
      ctx.fillRect(fx, fy, fw, fh);
    }
  }

  // Pass 2: 用统一字号和基线绘制文字
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const layout of layouts) {
    ctx.font = `bold ${layout.fontSize}px ${fontFamily}`;
    ctx.fillStyle = layout.textColor;

    for (const glyph of layout.glyphs) {
      const [bx, , bw] = glyph.bbox;
      ctx.fillText(glyph.letter, bx + bw / 2, layout.centerY);
    }
  }
}

function resolveOptions(options?: InpaintOptions): Required<InpaintOptions> {
  return {
    bleedRatio: options?.bleedRatio ?? 0.12,
    fontRatio: options?.fontRatio ?? 0.75,
    fontFamily: options?.fontFamily ?? "system-ui, -apple-system, sans-serif",
  };
}

// ─── 中文整行渲染 ──────────────────────────────────────────────────────

/**
 * 在原图上渲染中文翻译。
 *
 * 与英文逐字符替换不同，中文是整行替换：
 *   1. 用行聚类得到每行的 glyph 分组
 *   2. 从识别文本 `text` 按行拆分，与 translatedLines 一一对应
 *   3. 每行整体擦除后，在行级 bbox 居中绘制中文
 *
 * @param translatedLines 按行对应的中文翻译（与 text.split('\n') 一一对应）
 */
function paintChineseRows(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  canvasW: number,
  canvasH: number,
  glyphs: RecognizedGlyph[],
  translatedLines: string[],
  options: Required<InpaintOptions>,
): void {
  const { bleedRatio, fontRatio, fontFamily } = options;
  const rows = groupIntoRows(glyphs);
  if (rows.length === 0) return;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const rowGlyphs = rows[rowIdx]!;
    const chineseLine = translatedLines[rowIdx]?.trim();
    if (!chineseLine) continue;

    // 计算行级 bbox（从最左到最右 glyph 的外接框）
    let rowLeft = Infinity, rowTop = Infinity;
    let rowRight = -Infinity, rowBottom = -Infinity;
    for (const g of rowGlyphs) {
      const [bx, by, bw, bh] = g.bbox;
      rowLeft = Math.min(rowLeft, bx);
      rowTop = Math.min(rowTop, by);
      rowRight = Math.max(rowRight, bx + bw);
      rowBottom = Math.max(rowBottom, by + bh);
    }

    const rowHeight = rowBottom - rowTop;
    const rowWidth = rowRight - rowLeft;

    // Pass 1: 擦除整行区域
    const bleed = Math.max(1, Math.round(rowHeight * bleedRatio));
    for (const g of rowGlyphs) {
      const [bx, by, bw, bh] = g.bbox;
      const bg = estimateBackground(imageData, bx, by, bw, bh);
      const fx = Math.max(0, bx - bleed);
      const fy = Math.max(0, by - bleed);
      const fw = Math.min(canvasW - fx, bw + bleed * 2);
      const fh = Math.min(canvasH - fy, bh + bleed * 2);
      ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
      ctx.fillRect(fx, fy, fw, fh);
    }

    // Pass 2: 绘制中文文本
    const midGlyph = rowGlyphs[rowGlyphs.length >> 1]!;
    const bg = estimateBackground(
      imageData,
      midGlyph.bbox[0], midGlyph.bbox[1], midGlyph.bbox[2], midGlyph.bbox[3],
    );
    const textColor = contrastColor(bg);

    // 自适应字号：先按行高设置，如果文字太宽就缩小直到能放进行宽
    let fontSize = Math.max(10, Math.round(rowHeight * fontRatio));
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    let measured = ctx.measureText(chineseLine).width;

    while (measured > rowWidth && fontSize > 10) {
      fontSize = Math.max(10, fontSize - 1);
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      measured = ctx.measureText(chineseLine).width;
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chineseLine, (rowLeft + rowRight) / 2, (rowTop + rowBottom) / 2);
  }
}

// ─── 公开 API ───────────────────────────────────────────────────────────

/** 英文逐字符替换：返回 data URL */
export function renderTranslatedImage(
  bitmap: ImageBitmap,
  glyphs: RecognizedGlyph[],
  options?: InpaintOptions,
): string {
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  paintTranslatedGlyphs(ctx, imageData, bitmap.width, bitmap.height, glyphs, resolveOptions(options));
  return canvas.toDataURL("image/png");
}

/** 英文逐字符替换：返回 Blob（用于下载） */
export function renderTranslatedImageBlob(
  bitmap: ImageBitmap,
  glyphs: RecognizedGlyph[],
  options?: InpaintOptions,
): Promise<Blob | null> {
  if (typeof document === "undefined") return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  paintTranslatedGlyphs(ctx, imageData, canvas.width, canvas.height, glyphs, resolveOptions(options));

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * 中文整行替换：在原图上覆盖中文翻译，返回 data URL。
 *
 * @param translatedLines 按行对应的中文翻译
 */
export function renderChineseTranslatedImage(
  bitmap: ImageBitmap,
  glyphs: RecognizedGlyph[],
  translatedLines: string[],
  options?: InpaintOptions,
): string {
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const resolved = resolveOptions(options);
  // 中文使用更适合的字体族
  resolved.fontFamily = options?.fontFamily
    ?? '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

  paintChineseRows(ctx, imageData, canvas.width, canvas.height, glyphs, translatedLines, resolved);
  return canvas.toDataURL("image/png");
}

/** 中文整行替换：返回 Blob（用于下载） */
export function renderChineseTranslatedImageBlob(
  bitmap: ImageBitmap,
  glyphs: RecognizedGlyph[],
  translatedLines: string[],
  options?: InpaintOptions,
): Promise<Blob | null> {
  if (typeof document === "undefined") return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const resolved = resolveOptions(options);
  resolved.fontFamily = options?.fontFamily
    ?? '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

  paintChineseRows(ctx, imageData, canvas.width, canvas.height, glyphs, translatedLines, resolved);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
