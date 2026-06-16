/**
 * 转换模式（英文 → 加密文字）状态。
 * 用 nanostore 存输入文本，切换模式后再切回来内容不丢失。
 */

import { atom } from "nanostores";

export const $encodeText = atom<string>("");
