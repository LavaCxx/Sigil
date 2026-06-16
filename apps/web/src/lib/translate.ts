/**
 * 英文 → 中文翻译服务。
 *
 * 当前实现：MyMemory API（免费、无需注册、无需 API Key）。
 * 匿名额度 5000 字符/天，游戏文本一般几十字符，完全够用。
 *
 * 接口抽象为 translateLines()，方便以后替换为 Transformers.js 离线引擎。
 */

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

export interface TranslationResult {
  /** 原文各句（已把软换行的同一句合并） */
  sourceLines: string[];
  /** 翻译后各句（与 sourceLines 一一对应） */
  translatedLines: string[];
  /** 拼接后的完整翻译 */
  translatedText: string;
}

/**
 * 把识别出的「视觉行」重排成「逻辑句子」。
 *
 * 问题：游戏文本会按宽度自动换行，同一句话被拆到多行。若按视觉行分别翻译，
 * 会把一句话切碎、翻译质量差。
 *
 * 规则（保守、无词典）：
 *  - 依次累积视觉行；遇到新行时，若已累积内容以句末标点(. ! ?)结尾 → 视为一句结束，
 *    另起一句；否则视为软换行，用空格拼接到同一句。
 *  - 行尾是连字符 `-` → 认为是断词续行，去掉连字符直接拼接（不加空格）。
 *  - 逗号/冒号/分号不算句子结束，继续拼接（如「GO AWAY,」换行接下一行）。
 */
export function reflowToSentences(text: string): string[] {
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const sentences: string[] = [];
  let cur = "";
  for (const line of rawLines) {
    if (cur === "") {
      cur = line;
    } else if (/[.!?]$/.test(cur)) {
      sentences.push(cur);
      cur = line;
    } else if (/-$/.test(cur)) {
      cur = cur.slice(0, -1) + line;
    } else {
      cur = `${cur} ${line}`;
    }
  }
  if (cur) sentences.push(cur);
  return sentences;
}

/**
 * 批量翻译：先把软换行的视觉行重排成逻辑句子，再合并为一个请求发送。
 *
 * 这样跨行的同一句话会被整句翻译，而不是被按行切碎。
 */
export async function translateText(englishText: string): Promise<TranslationResult> {
  const sourceLines = reflowToSentences(englishText);
  if (sourceLines.length === 0) {
    return { sourceLines: [], translatedLines: [], translatedText: "" };
  }

  const joinedText = sourceLines.join("\n");

  const url = new URL(MYMEMORY_ENDPOINT);
  url.searchParams.set("q", joinedText);
  url.searchParams.set("langpair", "en|zh-CN");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`翻译请求失败: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    responseStatus: number;
    responseData: { translatedText: string };
  };

  if (data.responseStatus !== 200) {
    throw new Error(`翻译服务返回错误: status=${data.responseStatus}`);
  }

  const rawTranslated = data.responseData.translatedText;
  const translatedLines = rawTranslated.split("\n");

  // MyMemory 可能不严格保持行数，做一下对齐
  while (translatedLines.length < sourceLines.length) {
    translatedLines.push("");
  }

  return {
    sourceLines,
    translatedLines: translatedLines.slice(0, sourceLines.length),
    translatedText: translatedLines.slice(0, sourceLines.length).join("\n"),
  };
}
