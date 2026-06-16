/**
 * 分割参数调试 store：可在 DebugPanel 中实时调整，触发重新识别。
 */

import { atom } from "nanostores";
import type { SegmentConfig } from "~/lib/cv/segment";
import { DEFAULT_SEGMENT_CONFIG } from "~/lib/cv/segment";

export const $segmentConfig = atom<SegmentConfig>({ ...DEFAULT_SEGMENT_CONFIG });
