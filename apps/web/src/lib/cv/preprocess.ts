/**
 * 预处理阶段：把任意大小的彩色截图，转为「白底黑字」的灰度图 + 二值图。
 *
 * 输出两个 Mat：
 *   - working: CV_8UC1 灰度图（已缩放、极性统一为白底黑字、保留抗锯齿灰阶），
 *              是 patch 抽取(分类输入)的数据源 —— 低分辨率下抗锯齿灰阶携带
 *              亚像素信息，绝不能在分类前被硬二值化丢掉。
 *   - binary:  CV_8UC1 二值图（白底=255，前景=0），仅供投影分割/bbox/噪点过滤使用
 *
 * 调用方负责对返回的两张 Mat 调用 .delete() 释放 WASM 堆。
 *
 * 设计要点：
 * 1. 图像太大时按最长边缩放到 MAX_DIM，避免 OpenCV 跑得很慢。
 * 2. 用 Otsu 全局阈值做主二值化（NTE 游戏 UI 多为高对比度文本，Otsu 够用）；
 *    必要时可在 segment 失败时回落到 adaptiveThreshold。
 * 3. 自动判断前景极性：默认 NTE 文本是浅色字 / 深色背景，所以阈值后会得到
 *    "白色文字 + 黑色背景"。我们统一翻转成 "白底黑字"（binary 与 working 同步翻转），
 *    让后续 segment / 模型的输入语义和训练时一致
 *    （mapping.json 声明 background=white, foreground=black）。
 */

/** 把短边/长边稳定在这个范围内：太小检测不准，太大太慢。 */
const MAX_DIM = 1280;
const MIN_DIM = 480;

export interface PreprocessResult {
  /** 灰度图（已缩放、极性统一为白底黑字、保留抗锯齿灰阶），patch 抽取的数据源 */
  working: unknown; // cv.Mat
  /** 二值化结果（255 背景 / 0 前景），仅供分割阶段使用 */
  binary: unknown; // cv.Mat
  /** 原图 → 缩放后图的等比因子，便于把 bbox 反映射回原图坐标 */
  scale: number;
  /** 缩放后尺寸 */
  width: number;
  height: number;
}

export async function preprocess(bitmap: ImageBitmap, cv?: any): Promise<PreprocessResult> {

  // 1) ImageBitmap -> ImageData -> cv.Mat
  const targetScale = computeScale(bitmap.width, bitmap.height);
  const sw = Math.max(1, Math.round(bitmap.width * targetScale));
  const sh = Math.max(1, Math.round(bitmap.height * targetScale));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建 2D Canvas 上下文");
  ctx.drawImage(bitmap, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);

  // matFromImageData 直接吃 RGBA
  const src = (cv as unknown as {
    matFromImageData: (d: ImageData) => unknown;
  }).matFromImageData(imageData);

  const gray = new (cv as unknown as { Mat: new () => unknown }).Mat();
  try {
    // 2) 灰度
    (cv as unknown as {
      cvtColor: (s: unknown, d: unknown, code: number) => void;
      COLOR_RGBA2GRAY: number;
    }).cvtColor(src, gray, (cv as unknown as { COLOR_RGBA2GRAY: number }).COLOR_RGBA2GRAY);
  } finally {
    (src as { delete: () => void }).delete();
  }

  // 3) Otsu 二值化（先得到一张 0/255 图）
  const binary = new (cv as unknown as { Mat: new () => unknown }).Mat();
  const cvAny = cv as unknown as {
    threshold: (
      src: unknown,
      dst: unknown,
      thresh: number,
      maxval: number,
      type: number
    ) => number;
    THRESH_BINARY: number;
    THRESH_OTSU: number;
    countNonZero: (m: unknown) => number;
    bitwise_not: (s: unknown, d: unknown) => void;
    morphologyEx: (s: unknown, d: unknown, op: number, k: unknown) => void;
    getStructuringElement: (shape: number, size: unknown) => unknown;
    MORPH_OPEN: number;
    MORPH_RECT: number;
    Size: new (w: number, h: number) => unknown;
  };
  cvAny.threshold(
    gray,
    binary,
    0,
    255,
    cvAny.THRESH_BINARY | cvAny.THRESH_OTSU
  );

  // 4) 极性判断：若 "白像素" 占少数，则说明前景是白的（深色背景上的浅色字），
  //    我们要的是 "白底黑字"，因此翻转。灰度图同步翻转，
  //    保证 patch 抽取(走灰度)和分割(走二值)的极性一致。
  const whiteRatio = cvAny.countNonZero(binary) / (sw * sh);
  if (whiteRatio < 0.5) {
    cvAny.bitwise_not(binary, binary);
    cvAny.bitwise_not(gray, gray);
  }

  // 注：去掉形态学开运算。原先用 2x2 kernel 去椒盐噪点，
  // 但会把多部件字符之间的 1px 细桥腐蚀断，导致同一个字符
  // 有时连着（识别对）有时断开（被拆成两半）。
  // 训练数据本身有噪声增强，模型能容忍少量椒盐。

  return {
    working: gray,
    binary,
    scale: targetScale,
    width: sw,
    height: sh,
  };
}

function computeScale(w: number, h: number): number {
  const longest = Math.max(w, h);
  const shortest = Math.min(w, h);
  if (longest > MAX_DIM) return MAX_DIM / longest;
  if (shortest < MIN_DIM && longest < MAX_DIM) {
    return Math.min(MAX_DIM / longest, MIN_DIM / shortest);
  }
  return 1;
}
