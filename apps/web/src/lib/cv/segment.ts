/**
 * 分割阶段：把白底黑字的二值图切成单个字符的 ROI（投影法）。
 *
 * 为什么用投影法而不是 connectedComponents+合并：
 *   NTE 自创字体里大量字母是「多笔画不相连」的（Y=3 撇、F=3、E=2、P=2…），
 *   连通块会把一个字拆成好几块，靠尺寸启发式再合并极其脆弱（容易把相邻字母也并掉，
 *   或把一个字的笔画漏并）。
 *
 * 投影法利用「一个字在一行里只占一个水平槽位」这一强先验：
 *   1. 水平投影找出文字行带。
 *   2. 行带内做垂直(列)投影，得到一段段「有墨水的列区间(span)」。
 *      同一个字的多笔画在列方向几乎总是重叠/紧邻 → 自然连成一个 span 或仅隔 1~2px；
 *      相邻字母之间则有明显空列。
 *   3. 用「相对该行中位列间隙」的自适应阈值把 span 合并成字：
 *        - 间隙 < 0.5×中位间隙 → 同一个字（合并）
 *        - 间隙 > 1.7×中位间隙 → 词间空格
 *      （自适应、尺度无关，避免固定阈值把 7px 字间隙误并。）
 *   4. 每个字按「行大写字高 + 基线」做保尺寸 patch 抽取（规格同训练端 render.py）。
 *
 * patch 数据源（重要）：
 *   分割/定位 用二值图（投影法需要干净的前景判定）；
 *   patch 像素 用灰度图 + patch 级对比度归一化（百分位拉伸）。
 *   低分辨率下抗锯齿灰阶是亚像素信息——硬二值化会把分离笔画之间的中间灰
 *   误判成前景（粘连）、把边缘切成台阶（毛糙），这些损失不可逆。
 *   归一化协议必须与训练端 dataset.py 的 normalize_contrast 一致。
 */

import type { PreprocessResult } from "./preprocess";

/** 模型输入边长（来自 mapping.json model_input.shape: [batch,1,64,64]） */
export const MODEL_INPUT_SIZE = 64;

// —— 保尺寸抽取规格（必须与训练端 render.py 保持一致）——
// render.py: IMG_SIZE=64, CAP_H=44, CAP_TOP=8, BASELINE_Y=52
const CANVAS_CAP_H = 44;
const CANVAS_BASELINE = 52;

/** 分割阶段的可调参数（默认值），可在调试面板中实时修改 */
export interface SegmentConfig {
  /** 行带最小高度(px)，低于此值视为噪点行丢弃 */
  minLineHeight: number;
  /** 相邻行带垂直间距 < 此值(px) 时合并为同一行（处理行内笔画断裂） */
  lineMergeGap: number;
  /** 同字合并阈值：列间隙 < 此倍数 × 该行中位列间隙 → 视为同一个字的笔画 */
  mergeGapFactor: number;
  /**
   * 同字合并「绝对地板」：列间隙 < 此倍数 × 行高 → 一定合并（与中位间隙无关）。
   * 专治高清图里 A/Z 这类「左右两瓣」字符内部的小缝(实测最大 ≈0.07×字高)被切成两块：
   * 模糊图里这条缝会被糊上连成一块，高清图里缝是干净空列才会暴露问题。
   * 取值需 > 字符内部最大缝(~0.07)、又 < 正常字间距，0.13 居中且尺度无关。
   */
  intraGlyphGapFloor: number;
  /** 空格阈值：列间隙 > 此倍数 × 该行中位列间隙 → 词间空格 */
  spaceGapFactor: number;
  /** 行大写字高估计用的高度百分位(0-1)，避开小标点干扰 */
  capHeightPercentile: number;
  /** 字形最小宽度(px)，更小且更矮的视为噪点 */
  minGlyphWidth: number;
  /** 字形前景像素下限 = 此值 × capH²，低于则视为噪点（仍保留句号等小标点） */
  minGlyphFgRatio: number;
  /**
   * 过宽 span 自动拆分：宽度 > 此倍数 × 行内中位字宽 → 在列投影谷底切开。
   * 专治低分辨率下 RE/TH 等被 Otsu 粘成一块的情况。
   */
  wideSplitFactor: number;
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  minLineHeight: 6,
  lineMergeGap: 6,
  mergeGapFactor: 0.5,
  intraGlyphGapFloor: 0.08,
  spaceGapFactor: 1.7,
  capHeightPercentile: 0.72,
  minGlyphWidth: 2,
  minGlyphFgRatio: 0.003,
  wideSplitFactor: 1.35,
};

export interface DetectedGlyph {
  /** 在 preprocess 后的图像里的 bbox（不是原图） */
  bbox: [number, number, number, number];
  /** 在原图里的 bbox（反映射回去），UI 标注用 */
  bboxOriginal: [number, number, number, number];
  /** 行号 (0-based, top→bottom) */
  rowIndex: number;
  /** 列号 (0-based, left→right within row) */
  colIndex: number;
  /** 该字符前是否要插入空格 */
  spaceBefore: boolean;
  /** 64x64 灰度 patch（保留抗锯齿灰阶 + 对比度归一化）。length=64*64，0=黑 255=白 */
  patch: Uint8ClampedArray;
}

export interface SegmentResult {
  glyphs: DetectedGlyph[];
  /** 分割阶段过滤掉的（噪点）数量（调试用） */
  rejectedCount: number;
  /** 调试统计：沿用旧字段名以兼容 UI */
  debugStats?: {
    rawComponents: number;
    afterFilter: number;
    afterMergeL1: number;
    afterMergeL2: number;
    afterPunctFilter: number;
  };
}

interface ComponentBox {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

export async function segment(
  pre: PreprocessResult,
  _cv?: unknown,
  config?: Partial<SegmentConfig>,
  /** 归一化 x∈[0,1]，相对 preprocess 宽度；用户手动竖线强制切分 */
  manualSplitXs?: number[],
): Promise<SegmentResult> {
  const cfg = { ...DEFAULT_SEGMENT_CONFIG, ...config };
  const W = pre.width;
  const H = pre.height;
  const bin = matToUint8Array(pre.binary, W, H); // 255=背景 / 0=前景，仅供分割定位
  const gray = matToUint8Array(pre.working, W, H); // 白底黑字灰度，patch 像素来源

  // 1) 水平投影 → 行带
  const rowFg = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    const off = y * W;
    for (let x = 0; x < W; x++) if (bin[off + x]! < 128) s++;
    rowFg[y] = s;
  }
  let bands: Array<[number, number]> = [];
  {
    let y = 0;
    while (y < H) {
      if (rowFg[y]! > 0) {
        const y0 = y;
        while (y < H && rowFg[y]! > 0) y++;
        bands.push([y0, y]);
      } else y++;
    }
  }
  // 合并垂直间距很小的行带（同一行内笔画断裂导致的多带）
  const mergedBands: Array<[number, number]> = [];
  for (const b of bands) {
    const last = mergedBands[mergedBands.length - 1];
    if (last && b[0] - last[1] < cfg.lineMergeGap) last[1] = b[1];
    else mergedBands.push([b[0], b[1]]);
  }
  bands = mergedBands.filter((b) => b[1] - b[0] >= cfg.minLineHeight);

  const glyphs: DetectedGlyph[] = [];
  const invScale = 1 / pre.scale;
  let totalSpans = 0;

  for (let r = 0; r < bands.length; r++) {
    const [by0, by1] = bands[r]!;

    // 2) 列投影：用灰度软阈值（低分辨率下 Otsu 会把字间缝填死，灰度谷底仍可分）
    const { colFg, rowBg } = buildGrayColumnProjection(gray, bin, W, by0, by1);
    const spans: Array<[number, number]> = [];
    {
      let x = 0;
      while (x < W) {
        if (colFg[x]! > 0) {
          const x0 = x;
          while (x < W && colFg[x]! > 0) x++;
          spans.push([x0, x]);
        } else x++;
      }
    }
    if (spans.length === 0) continue;
    totalSpans += spans.length;

    // 3) 自适应阈值合并 span → 字
    const lineH = by1 - by0; // 行高，近似大写字高，作为「绝对地板」的尺度基准
    const gaps: number[] = [];
    for (let i = 0; i < spans.length - 1; i++) gaps.push(spans[i + 1]![0] - spans[i]![1]);
    const medGap = gaps.length ? median(gaps) : Math.max(4, Math.round(lineH * 0.08));
    const spaceThr = cfg.spaceGapFactor * medGap;
    // 合并阈值：相对间隙 + 比例地板；像素硬地板随字高缩放(不再固定 3px)
    const pxFloor = Math.max(1, Math.round(lineH * 0.025));
    const mergeThr = Math.min(
      Math.max(pxFloor, cfg.mergeGapFactor * medGap, cfg.intraGlyphGapFloor * lineH),
      Math.max(pxFloor, spaceThr - 1),
    );

    let gspans: Array<[number, number]> = [[spans[0]![0], spans[0]![1]]];
    for (let i = 1; i < spans.length; i++) {
      const sp = spans[i]!;
      const last = gspans[gspans.length - 1]!;
      if (sp[0] - last[1] < mergeThr) last[1] = sp[1];
      else gspans.push([sp[0], sp[1]]);
    }

    // 过宽 span 自动拆分（RE/TH 等低清粘连）
    let boxes = gspans.map(([g0, g1]) => tightBox(bin, W, by0, by1, g0, g1));
    const charWidths = boxes.map((b) => b.w).filter((w) => w > 0).sort((a, b) => a - b);
    const medCharW = charWidths.length
      ? charWidths[Math.floor(charWidths.length / 2)]!
      : Math.max(4, Math.round(lineH * 0.45));
    gspans = splitOversizedGspans(gspans, colFg, medCharW, lineH, cfg.wideSplitFactor);

    // 用户手动竖线强制切分
    if (manualSplitXs?.length) {
      const cuts = manualSplitXs
        .map((n) => Math.round(n * W))
        .filter((x) => x > 0 && x < W)
        .sort((a, b) => a - b);
      for (const sx of cuts) {
        const next: Array<[number, number]> = [];
        for (const [g0, g1] of gspans) {
          if (sx <= g0 || sx >= g1) next.push([g0, g1]);
          else next.push([g0, sx], [sx, g1]);
        }
        gspans = next;
      }
    }

    boxes = gspans.map(([g0, g1]) => tightBox(bin, W, by0, by1, g0, g1));

    // 行大写字高 + 基线
    const heights = boxes.map((b) => b.h).filter((h) => h > 0).sort((a, b) => a - b);
    const maxH = heights[heights.length - 1] ?? 1;
    const capH = Math.max(
      1,
      heights[Math.min(heights.length - 1, Math.floor(cfg.capHeightPercentile * heights.length))] ?? maxH,
    );
    const tallBottoms = boxes
      .filter((b) => b.h >= 0.6 * maxH)
      .map((b) => b.y + b.h)
      .sort((a, b) => a - b);
    const bottoms = tallBottoms.length ? tallBottoms : boxes.map((b) => b.y + b.h).sort((a, b) => a - b);
    const baselineY = bottoms[Math.floor(bottoms.length / 2)] ?? by1;

    const noiseFg = Math.max(2, cfg.minGlyphFgRatio * capH * capH);

    // 4) 逐字抽 patch
    let prevRight: number | null = null;
    let col = 0;
    for (let gi = 0; gi < gspans.length; gi++) {
      const [g0, g1] = gspans[gi]!;
      const box = boxes[gi]!;
      if (box.area < noiseFg || (box.w < cfg.minGlyphWidth && box.h < cfg.minGlyphWidth)) {
        continue; // 噪点
      }
      const spaceBefore = prevRight !== null && g0 - prevRight > spaceThr;
      prevRight = g1;

      // 水平隔离：patch 只取 [clipLeft, clipRight)，外侧填行背景色（防邻字渗入）
      const margin = 3;
      let clipLeft = g0 - margin;
      let clipRight = g1 + margin;
      if (gi > 0) clipLeft = Math.max(clipLeft, Math.round((gspans[gi - 1]![1] + g0) / 2));
      if (gi < gspans.length - 1) clipRight = Math.min(clipRight, Math.round((g1 + gspans[gi + 1]![0]) / 2));

      const comp: ComponentBox = { x: box.x, y: box.y, w: box.w, h: box.h, area: box.area };
      const patch = extractPatchBand(gray, W, H, comp, capH, baselineY, clipLeft, clipRight, rowBg);
      glyphs.push({
        bbox: [box.x, box.y, box.w, box.h],
        bboxOriginal: [
          Math.round(box.x * invScale),
          Math.round(box.y * invScale),
          Math.round(box.w * invScale),
          Math.round(box.h * invScale),
        ],
        rowIndex: r,
        colIndex: col,
        spaceBefore,
        patch,
      });
      col++;
    }
  }

  return {
    glyphs,
    rejectedCount: totalSpans - glyphs.length,
    debugStats: {
      rawComponents: totalSpans,
      afterFilter: glyphs.length,
      afterMergeL1: glyphs.length,
      afterMergeL2: glyphs.length,
      afterPunctFilter: glyphs.length,
    },
  };
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** 行内灰度列投影：比二值更能在低分辨率下保留字间谷底 */
function buildGrayColumnProjection(
  gray: Uint8Array,
  bin: Uint8Array,
  W: number,
  by0: number,
  by1: number,
): { colFg: Int32Array; rowBg: number } {
  let bgSum = 0;
  let bgCount = 0;
  for (let y = by0; y < by1; y++) {
    const off = y * W;
    for (let x = 0; x < W; x++) {
      if (bin[off + x]! >= 128) {
        bgSum += gray[off + x]!;
        bgCount++;
      }
    }
  }
  const rowBg = bgCount > 0 ? Math.round(bgSum / bgCount) : 240;
  const inkThr = Math.max(80, rowBg - 38);

  const colFg = new Int32Array(W);
  for (let y = by0; y < by1; y++) {
    const off = y * W;
    for (let x = 0; x < W; x++) {
      if (gray[off + x]! < inkThr) colFg[x]++;
    }
  }
  return { colFg, rowBg };
}

/** 过宽 span 在列投影谷底切开 */
function splitOversizedGspans(
  gspans: Array<[number, number]>,
  colFg: Int32Array,
  medCharW: number,
  lineH: number,
  wideSplitFactor: number,
): Array<[number, number]> {
  const maxW = Math.max(medCharW * wideSplitFactor, lineH * 0.62);
  let segments = gspans.map((s) => s as [number, number]);

  for (let pass = 0; pass < 6; pass++) {
    const next: Array<[number, number]> = [];
    let changed = false;
    for (const [g0, g1] of segments) {
      const w = g1 - g0;
      if (w <= maxW) {
        next.push([g0, g1]);
        continue;
      }
      const split = findColumnValley(colFg, g0, g1, medCharW);
      if (split === null) {
        next.push([g0, g1]);
        continue;
      }
      next.push([g0, split], [split, g1]);
      changed = true;
    }
    segments = next;
    if (!changed) break;
  }
  return segments;
}

function findColumnValley(
  colFg: Int32Array,
  g0: number,
  g1: number,
  medCharW: number,
): number | null {
  const margin = Math.max(2, Math.round(medCharW * 0.28));
  const minX = g0 + margin;
  const maxX = g1 - margin;
  if (maxX <= minX) return null;

  let peak = 0;
  for (let x = g0; x < g1; x++) {
    const v = (colFg[x - 1] ?? 0) + colFg[x]! + (colFg[x + 1] ?? 0);
    if (v > peak) peak = v;
  }
  if (peak <= 0) return null;

  let bestX = -1;
  let bestVal = Infinity;
  for (let x = minX; x <= maxX; x++) {
    const v = (colFg[x - 1] ?? 0) + colFg[x]! + (colFg[x + 1] ?? 0);
    if (v < bestVal) {
      bestVal = v;
      bestX = x;
    }
  }
  // 谷底需足够深（相对峰值），否则不拆
  if (bestX < 0 || bestVal > peak * 0.55) return null;
  return bestX;
}

/** 在 [g0,g1)×[by0,by1) 区域内求前景的紧致 bbox 与像素数 */
function tightBox(
  bin: Uint8Array,
  W: number,
  by0: number,
  by1: number,
  g0: number,
  g1: number,
): ComponentBox {
  let minX = g1,
    minY = by1,
    maxX = g0,
    maxY = by0,
    area = 0;
  for (let y = by0; y < by1; y++) {
    const off = y * W;
    for (let x = g0; x < g1; x++) {
      if (bin[off + x]! < 128) {
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (area === 0) return { x: g0, y: by0, w: g1 - g0, h: by1 - by0, area: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
}

/** 把 Mat 的整张图拷成 Uint8Array (灰度) */
function matToUint8Array(mat: unknown, w: number, h: number): Uint8Array {
  const m = mat as { data: Uint8Array };
  return new Uint8Array(m.data.buffer, m.data.byteOffset, w * h);
}

/**
 * 保尺寸抽取：以「行的大写字高 capH + 基线 baselineY」为基准，构造统一规格的方形窗口，
 * 把字形按真实大小与垂直位置放进去，再缩放到 64×64，最后做对比度归一化。
 *
 * 窗口规格与训练端 render.py 严格对应（画布 64、大写字高 44、基线 52），
 * 这样小标点(句号/逗号)天然小且贴近基线，不会被放大铺满，与训练分布一致。
 *
 * 像素来源是灰度图。窗口外 / clip 隔离区填行背景色（normalize 后趋近 255），
 * 不拷贝邻字像素。
 */
function extractPatchBand(
  gray: Uint8Array,
  imgW: number,
  imgH: number,
  comp: ComponentBox,
  capH: number,
  baselineY: number,
  clipLeft: number,
  clipRight: number,
  bgFill: number,
): Uint8ClampedArray {
  const S = Math.max(8, Math.round((capH * MODEL_INPUT_SIZE) / CANVAS_CAP_H));
  const baselineInWindow = (CANVAS_BASELINE / MODEL_INPUT_SIZE) * S;

  const cx = comp.x + comp.w / 2;
  const x0 = Math.round(cx - S / 2);
  const y0 = Math.round(baselineY - baselineInWindow);

  const buf = new Uint8ClampedArray(S * S);
  buf.fill(255);

  for (let yy = 0; yy < S; yy++) {
    const srcY = y0 + yy;
    if (srcY < 0 || srcY >= imgH) continue;
    for (let xx = 0; xx < S; xx++) {
      const srcX = x0 + xx;
      if (srcX < 0 || srcX >= imgW) continue;
      if (srcX < clipLeft || srcX >= clipRight) {
        buf[yy * S + xx] = bgFill;
        continue;
      }
      buf[yy * S + xx] = gray[srcY * imgW + srcX]!;
    }
  }

  const resized = resizeBilinear(buf, S, S, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  return normalizeContrast(resized);
}

/** 归一化保护：动态范围低于此值的 patch（近空白/纯噪声）不拉伸，避免放大噪声 */
const NORM_MIN_RANGE = 32;

/** 视为「窗口外填充」的 sentinel 白，不参与对比度分位统计 */
const NORM_SENTINEL_WHITE = 252;

/**
 * patch 级对比度归一化：对「内容像素」(非 sentinel 255) 做 1%/99% 拉伸。
 *
 * 若用全图分位，保尺寸窗口里大量 sentinel 255 会把真实背景(~220)压成浅灰矩形——
 * 这是 debug patch 里常见的外围灰框伪影，不是正常现象。
 * 协议必须与训练端 dataset.py 的 normalize_contrast 严格一致。
 */
function normalizeContrast(patch: Uint8ClampedArray): Uint8ClampedArray {
  const n = patch.length;
  const contentIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (patch[i]! < NORM_SENTINEL_WHITE) contentIdx.push(i);
  }
  // 极小标点：内容像素太少时退回全图统计
  const useIdx = contentIdx.length >= n * 0.05 ? contentIdx : [...Array(n).keys()];

  const hist = new Uint32Array(256);
  for (const i of useIdx) hist[patch[i]!]++;

  const sampleN = useIdx.length;
  const loCount = sampleN * 0.01;
  const hiCount = sampleN * 0.99;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= loCount) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= hiCount) {
      hi = v;
      break;
    }
  }

  if (hi - lo < NORM_MIN_RANGE) return patch;

  const scale = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    patch[i] = (patch[i]! - lo) * scale;
  }
  whitenBackground(patch);
  return patch;
}

/** 拉伸后把估计背景漂到 255，消除截图灰底形成的浅灰矩形 */
function whitenBackground(patch: Uint8ClampedArray): void {
  const sorted = [...patch].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.88)] ?? 255;
  const thr = Math.max(175, bg - 18);
  for (let i = 0; i < patch.length; i++) {
    if (patch[i]! >= thr) patch[i] = 255;
  }
}

function resizeBilinear(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dw * dh);
  const xRatio = (sw - 1) / dw;
  const yRatio = (sh - 1) / dh;

  for (let y = 0; y < dh; y++) {
    const sy = y * yRatio;
    const y1 = Math.floor(sy);
    const y2 = Math.min(y1 + 1, sh - 1);
    const dy = sy - y1;
    for (let x = 0; x < dw; x++) {
      const sx = x * xRatio;
      const x1 = Math.floor(sx);
      const x2 = Math.min(x1 + 1, sw - 1);
      const dx = sx - x1;

      const a = src[y1 * sw + x1]!;
      const b = src[y1 * sw + x2]!;
      const c = src[y2 * sw + x1]!;
      const d = src[y2 * sw + x2]!;

      const v =
        a * (1 - dx) * (1 - dy) +
        b * dx * (1 - dy) +
        c * (1 - dx) * dy +
        d * dx * dy;
      dst[y * dw + x] = Math.round(v);
    }
  }
  return dst;
}
