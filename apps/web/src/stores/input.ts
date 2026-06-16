/**
 * 当前输入图像状态。
 */

import { atom } from "nanostores";
import type { InputImage } from "~/types/pack";
import { clearManualSplits } from "./manualSplits";

export const $currentInput = atom<InputImage | null>(null);

/**
 * 手动框选区域 (ROI)，归一化坐标 [0,1]，相对原图。
 * 为 null 时表示对整图识别（理想截图的默认行为）。
 * 用途：整屏截图里文字只占一小块时，先框出文字区域再识别。
 */
export interface NormalizedRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const $roi = atom<NormalizedRoi | null>(null);

export function setRoi(roi: NormalizedRoi | null): void {
  $roi.set(roi);
}

/** 接收一张图像（来自任何输入源），自动解码为 ImageBitmap 并生成预览 URL。 */
export async function ingestImage(
  blob: Blob,
  source: InputImage["source"]
): Promise<void> {
  const previous = $currentInput.get();
  if (previous) {
    URL.revokeObjectURL(previous.previewUrl);
    previous.bitmap.close();
  }

  const bitmap = await createImageBitmap(blob);
  const previewUrl = URL.createObjectURL(blob);
  $roi.set(null); // 新图像清空旧选区
  clearManualSplits();
  $currentInput.set({
    bitmap,
    previewUrl,
    source,
    receivedAt: Date.now(),
  });
}

export function clearInput(): void {
  const previous = $currentInput.get();
  if (previous) {
    URL.revokeObjectURL(previous.previewUrl);
    previous.bitmap.close();
  }
  $roi.set(null);
  clearManualSplits();
  $currentInput.set(null);
}
