/**
 * 用户手动切分竖线：归一化 x∈[0,1]，相对 preprocess 后图像宽度。
 * 在预处理图上点击添加，重新识别时在对应 x 强制切开 span。
 */

import { atom } from "nanostores";

export const $manualSplitXs = atom<number[]>([]);

export function addManualSplit(normX: number): void {
  const x = Math.min(1, Math.max(0, normX));
  const prev = $manualSplitXs.get();
  // 同一位置 ±1% 视为重复点击，移除（切换）
  const dup = prev.findIndex((p) => Math.abs(p - x) < 0.012);
  if (dup >= 0) {
    $manualSplitXs.set(prev.filter((_, i) => i !== dup));
    return;
  }
  $manualSplitXs.set([...prev, x].sort((a, b) => a - b));
}

export function clearManualSplits(): void {
  $manualSplitXs.set([]);
}
