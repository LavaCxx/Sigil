import type { SegmentConfig } from "./segment";

/**
 * 根据原图尺寸推断分割参数微调。
 * 高瘦长图（多行竖排文字）上默认 floor 偏大、行带易过度合并。
 */
export function autoSegmentConfigForImage(
  width: number,
  height: number,
  user?: Partial<SegmentConfig>,
): Partial<SegmentConfig> {
  const aspect = height / Math.max(1, width);
  const tall = aspect > 1.4 || height > width * 1.2;
  const veryTall = aspect > 2.2;

  if (!tall) return user ?? {};

  return {
    ...user,
    intraGlyphGapFloor: Math.min(user?.intraGlyphGapFloor ?? 0.08, veryTall ? 0.05 : 0.06),
    lineMergeGap: Math.min(user?.lineMergeGap ?? 6, veryTall ? 3 : 4),
    wideSplitFactor: Math.max(user?.wideSplitFactor ?? 1.35, 1.22),
    mergeGapFactor: Math.min(user?.mergeGapFactor ?? 0.5, 0.42),
  };
}
