/**
 * 应用顶层功能模式：
 * - recognize: 识别（加密文字图片 → 英文）
 * - encode:    转换（英文 → 加密文字）
 */

import { atom } from "nanostores";

export type AppMode = "recognize" | "encode";

export const $appMode = atom<AppMode>("recognize");
