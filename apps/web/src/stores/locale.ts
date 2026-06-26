/**
 * 中英语言切换。
 *
 * 设计：
 * - $locale 是 nanostores atom；默认值在模块加载时从 localStorage 读取（SSR 安全：typeof 检查）。
 * - setLocale() 同步写 localStorage + 更新 <html lang> + document.title + meta description。
 * - 组件内用 useT() 拿到响应式 t 函数；非组件场景（store 错误消息等）直接调用 t()。
 * - 翻译字典是扁平 key（点分隔命名空间），用 {var} 占位符做插值。
 *
 * 新增文案：在 zh / en 两个字典里各加一条同 key 即可，未命中的 key 会回退到 key 本身。
 */

import { atom } from "nanostores";
import { useStore } from "@nanostores/solid";

export type Locale = "zh" | "en";

const STORAGE_KEY = "sigil.locale";

/**
 * 初始 locale 优先级：
 * 1. URL 参数 ?lang=en / ?lang=zh（明确意图，便于分享链接指定语言）
 * 2. localStorage（用户上次主动选择）
 * 3. 默认 zh
 *
 * URL 参数只决定初始值，不写 localStorage——用户后续切换时才记忆。
 */
function detectInitial(): Locale {
  if (typeof location !== "undefined") {
    const param = new URLSearchParams(location.search).get("lang");
    if (param === "zh" || param === "en") return param;
  }
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  }
  return "zh";
}

export const $locale = atom<Locale>(detectInitial());

function applyHtmlLang(loc: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = loc === "zh" ? "zh-CN" : "en";
  // 同步浏览器 tab 标题与 meta description，让 SSR 默认中文在客户端切换后也跟着变
  document.title = tc("page.title", loc);
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", tc("page.description", loc));
}

export function setLocale(loc: Locale): void {
  $locale.set(loc);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, loc);
  }
  applyHtmlLang(loc);
}

export function toggleLocale(): void {
  setLocale($locale.get() === "zh" ? "en" : "zh");
}

// ─── 字典 ──────────────────────────────────────────────────────────────────

const zh: Record<string, string> = {
  // page (SSR shell)
  "page.title": "Sigil · 游戏文字识别解密",
  "page.description": "游戏文字识别解密工具",

  // TopBar
  "topbar.subtitle": "游戏文字识别解密",
  "topbar.loadingPack": "加载字体包…",
  "topbar.model": "模型",
  "topbar.trainingAccuracy": "训练精度",

  // App
  "app.modeRecognize": "识别 · 加密文字 → 英文",
  "app.modeEncode": "转换 · 英文 → 加密文字",
  "app.footer": "Powered By Astro & SolidJS",

  // GameSelector
  "selector.game": "游戏:",
  "selector.selectPlaceholder": "选择…",
  "selector.selected": "已选",
  "selector.moreComing": "后续会添加更多游戏字体",

  // InputPanel
  "input.title": "输入图像",
  "input.clear": "清除",
  "input.dropHint": "把游戏截图拖到这里",
  "input.dropSubhint": "或使用下方按钮 · 也支持 Ctrl/Cmd+V 直接粘贴",
  "input.imageOnlyError": "仅支持图片格式 (收到 {type})",
  "input.unknownType": "未知",
  "input.clipboardNotSupported": "当前浏览器不支持剪贴板读取，请用 Ctrl/Cmd+V 直接粘贴",
  "input.noImageInClipboard": "剪贴板里没有图片",
  "input.screenCaptureNotSupported": "当前浏览器不支持屏幕捕获",
  "input.roiSelected": "已框选局部区域",
  "input.roiHint": "拖拽图片框选文字区域（可选）",
  "input.clearRoi": "清除选区",
  "input.upload": "上传",
  "input.paste": "粘贴",
  "input.capture": "截屏",
  "input.camera": "拍照",
  "input.recognizing": "识别中…",
  "input.startRecognize": "开始识别",
  "input.altPending": "待识别",

  // ResultPanel
  "result.title": "识别结果",
  "result.tabZH": "中文",
  "result.tabImageEN": "译图",
  "result.copied": "已复制",
  "result.copy": "复制",
  "result.generating": "生成中…",
  "result.download": "下载",
  "result.placeholder": "提供图片后点击 \"开始识别\"",
  "result.currentPack": "当前字体包：",
  "result.letters": "字母",
  "result.pipelineRunning": "流水线运行中…",
  "result.pipelineFlow": "预处理 → 分割 → 分类 → 拼装",
  "result.noChars": "未检测到字符。可能：图像中无字体包覆盖的文字，或分割阶段失败。",
  "result.charCount": "字符数",
  "result.avgConfidence": "平均置信度",
  "result.totalTime": "总耗时",
  "result.translating": "正在翻译…",
  "result.translateFailedPrefix": "翻译失败：",
  "result.translationHint": "原文 → 翻译 逐句对照（已合并软换行）",
  "result.willAutoTranslate": "识别完成后将自动翻译为中文",
  "result.enImageLabel": "英文",
  "result.imageGenerating": "{label}译图生成中…",
  "result.originalLabel": "原图",
  "result.translationLabel": "{label}翻译",
  "result.compareOriginal": "原图对比",
  "result.pipelineTimings": "流水线耗时",
  "result.altOriginalImage": "原图",
  "result.altTranslatedImage": "{label}翻译图像",

  // pipeline stages
  "stage.loading-cv": "加载 OpenCV.js（首次约 3-8 秒）",
  "stage.preprocess": "图像预处理 · 灰度 + 二值化",
  "stage.segment": "字符分割 · 连通域分析",
  "stage.loading-model": "加载 ONNX 模型",
  "stage.classify": "神经网络推理",
  "stage.postprocess": "拼装结果",

  // EncodePanel
  "encode.titleInput": "英文输入",
  "encode.clear": "清空",
  "encode.placeholder": "在此输入英文，例如 HELLO WORLD",
  "encode.waitingPack": "等待字体包加载…",
  "encode.renderHint": "字母将用 {pack} 的密文字体渲染",
  "encode.caseInsensitive": " · 不区分大小写（自动转为大写）",
  "encode.titleOutput": "加密文字",
  "encode.copyText": "复制文本",
  "encode.downloadImage": "下载图片",
  "encode.outputPlaceholder": "左侧输入英文，这里实时显示加密文字",
  "encode.loadingFont": "加载密文字体…",
  "encode.unsupportedHint": "以下字符不在字体包字符集内，将以普通字形显示：",

  // DebugPanel
  "debug.title": "调试 / 参数调节",
  "debug.segmentParams": "分割参数",
  "debug.reset": "重置默认",
  "debug.collapse": "折叠",
  "debug.expand": "展开",
  "debug.rerun": "重新识别",

  // group titles
  "debug.group.lineDetection": "行检测（水平投影）",
  "debug.group.glyphSplit": "字形切分（列投影 · 自适应间隙）",
  "debug.group.noiseFilter": "噪点过滤",

  // slider labels & hints
  "debug.slider.minLineHeight.label": "行带最小高度(px)",
  "debug.slider.minLineHeight.hint": "行带高度低于此值视为噪点行丢弃",
  "debug.slider.lineMergeGap.label": "行带合并间距(px)",
  "debug.slider.lineMergeGap.hint": "相邻行带垂直间距 < 此值时合并为同一行（处理笔画断裂）",
  "debug.slider.mergeGapFactor.label": "同字合并系数",
  "debug.slider.mergeGapFactor.hint": "列间隙 < 此系数 × 行中位列间隙 → 视为同一个字的多笔画。越大越爱合并",
  "debug.slider.intraGlyphGapFloor.label": "同字合并地板(×行高)",
  "debug.slider.intraGlyphGapFloor.hint": "列间隙 < 此系数 × 行高 → 一定合并。默认已降至 0.08；低清图若仍整词粘连，优先用过宽拆分或手动竖线",
  "debug.slider.wideSplitFactor.label": "过宽自动拆分(×中位字宽)",
  "debug.slider.wideSplitFactor.hint": "span 宽度 > 此倍数 × 行内中位字宽 → 在列投影谷底切开（专治 RE 粘连）",
  "debug.slider.spaceGapFactor.label": "空格系数",
  "debug.slider.spaceGapFactor.hint": "列间隙 > 此系数 × 行中位列间隙 → 词间空格",
  "debug.slider.capHeightPercentile.label": "字高估计百分位",
  "debug.slider.capHeightPercentile.hint": "用该百分位的字高作为行大写字高（影响 patch 抽取尺度）",
  "debug.slider.minGlyphWidth.label": "字形最小宽度(px)",
  "debug.slider.minGlyphWidth.hint": "更窄且更矮的视为噪点丢弃",
  "debug.slider.minGlyphFgRatio.label": "前景占比下限",
  "debug.slider.minGlyphFgRatio.hint": "前景像素 < 此值 × capH² 视为噪点（仍保留句号等小标点）",

  // stats
  "debug.stats.components": "连通块",
  "debug.stats.filter": "→ 过滤",
  "debug.stats.l1Merge": "→ L1合并",
  "debug.stats.l2Cluster": "→ L2聚类",
  "debug.stats.summary": "(滤掉 {filtered}，L1 合并 {l1}，L2 合并 {l2})",

  // captions
  "debug.caption.annotated": "标注后的原图（绿/黄/红 = 高/中/低置信度）",
  "debug.caption.annotatedAlt": "标注图",
  "debug.caption.preprocessed": "预处理灰度图（CV 输入）",
  "debug.caption.preprocessedAlt": "预处理图",
  "debug.splitModeOn": "切分模式：开",
  "debug.splitModeOff": "切分模式：关",
  "debug.clearSplits": "清除 {count} 条竖线",
  "debug.pipelineIntermediate": "流水线中间产物",
  "debug.rejectedBlocks": "(过滤掉 {count} 个连通块)",
  "debug.detectedPatches": "检测到的 glyph patches（{count} 个）",
  "debug.packNotLoaded": "未加载字体包",
  "debug.packMeta": "字体包元信息",

  // result.ts errors
  "error.packNotLoaded": "字体包未加载",
  "error.noImage": "请先提供一张图像",

  // 语言切换按钮
  "locale.toggleTo": "EN", // 中文模式下显示的按钮文案（点击切到英文）
};

const en: Record<string, string> = {
  // page
  "page.title": "Sigil · Game Text Cipher Solver",
  "page.description": "Game text cipher solver",

  // TopBar
  "topbar.subtitle": "Game text cipher solver",
  "topbar.loadingPack": "Loading pack…",
  "topbar.model": "Model",
  "topbar.trainingAccuracy": "Training acc.",

  // App
  "app.modeRecognize": "Recognize · Cipher → English",
  "app.modeEncode": "Encode · English → Cipher",
  "app.footer": "Powered by Astro & SolidJS",

  // GameSelector
  "selector.game": "Game:",
  "selector.selectPlaceholder": "Select…",
  "selector.selected": "Selected",
  "selector.moreComing": "More game packs will be added later",

  // InputPanel
  "input.title": "Input image",
  "input.clear": "Clear",
  "input.dropHint": "Drop a game screenshot here",
  "input.dropSubhint": "or use the buttons below · Ctrl/Cmd+V paste also works",
  "input.imageOnlyError": "Image files only (got {type})",
  "input.unknownType": "unknown",
  "input.clipboardNotSupported": "Clipboard read not supported; use Ctrl/Cmd+V to paste",
  "input.noImageInClipboard": "No image in clipboard",
  "input.screenCaptureNotSupported": "Screen capture not supported in this browser",
  "input.roiSelected": "ROI selected",
  "input.roiHint": "Drag on the image to crop the text region (optional)",
  "input.clearRoi": "Clear selection",
  "input.upload": "Upload",
  "input.paste": "Paste",
  "input.capture": "Capture",
  "input.camera": "Camera",
  "input.recognizing": "Recognizing…",
  "input.startRecognize": "Start recognition",
  "input.altPending": "pending",

  // ResultPanel
  "result.title": "Recognition result",
  "result.tabZH": "ZH",
  "result.tabImageEN": "Translated",
  "result.copied": "Copied",
  "result.copy": "Copy",
  "result.generating": "Generating…",
  "result.download": "Download",
  "result.placeholder": "Provide an image and hit \"Start recognition\"",
  "result.currentPack": "Current pack: ",
  "result.letters": "letters",
  "result.pipelineRunning": "Pipeline running…",
  "result.pipelineFlow": "preprocess → segment → classify → assemble",
  "result.noChars": "No characters detected. The image may not contain text covered by this pack, or segmentation failed.",
  "result.charCount": "Characters",
  "result.avgConfidence": "Avg confidence",
  "result.totalTime": "Total time",
  "result.translating": "Translating…",
  "result.translateFailedPrefix": "Translation failed: ",
  "result.translationHint": "Source → translation (soft line breaks merged)",
  "result.willAutoTranslate": "Auto-translates to Chinese after recognition",
  "result.enImageLabel": "English",
  "result.imageGenerating": "{label} image generating…",
  "result.originalLabel": "Original",
  "result.translationLabel": "{label} translation",
  "result.compareOriginal": "Compare original",
  "result.pipelineTimings": "Pipeline timings",
  "result.altOriginalImage": "original",
  "result.altTranslatedImage": "{label} translated image",

  // pipeline stages
  "stage.loading-cv": "Loading OpenCV.js (~3-8s first time)",
  "stage.preprocess": "Preprocess · grayscale + binarize",
  "stage.segment": "Segmentation · connected components",
  "stage.loading-model": "Loading ONNX model",
  "stage.classify": "Neural network inference",
  "stage.postprocess": "Assembling result",

  // EncodePanel
  "encode.titleInput": "English input",
  "encode.clear": "Clear",
  "encode.placeholder": "Type English here, e.g. HELLO WORLD",
  "encode.waitingPack": "Waiting for pack…",
  "encode.renderHint": "Letters will render in {pack}'s cipher font",
  "encode.caseInsensitive": " · case-insensitive (auto uppercased)",
  "encode.titleOutput": "Cipher text",
  "encode.copyText": "Copy text",
  "encode.downloadImage": "Download image",
  "encode.outputPlaceholder": "Type English on the left to see the cipher text here",
  "encode.loadingFont": "Loading cipher font…",
  "encode.unsupportedHint": "These characters are not in the pack and will render as plain glyphs:",

  // DebugPanel
  "debug.title": "Debug / parameters",
  "debug.segmentParams": "Segmentation params",
  "debug.reset": "Reset",
  "debug.collapse": "Collapse",
  "debug.expand": "Expand",
  "debug.rerun": "Re-run",

  "debug.group.lineDetection": "Line detection (horizontal projection)",
  "debug.group.glyphSplit": "Glyph splitting (column projection · adaptive gaps)",
  "debug.group.noiseFilter": "Noise filtering",

  "debug.slider.minLineHeight.label": "Min line height (px)",
  "debug.slider.minLineHeight.hint": "Row bands shorter than this are dropped as noise",
  "debug.slider.lineMergeGap.label": "Line merge gap (px)",
  "debug.slider.lineMergeGap.hint": "Adjacent bands within this vertical gap are merged (handles stroke breaks)",
  "debug.slider.mergeGapFactor.label": "Same-glyph merge factor",
  "debug.slider.mergeGapFactor.hint": "Column gap < this × row median gap → treated as same glyph's strokes. Higher = merge more aggressively",
  "debug.slider.intraGlyphGapFloor.label": "Merge floor (× row height)",
  "debug.slider.intraGlyphGapFloor.hint": "Column gap < this × row height → always merged. Default lowered to 0.08; if low-res images still stick whole words together, prefer over-wide splitting or manual vertical lines",
  "debug.slider.wideSplitFactor.label": "Over-wide auto split (× median width)",
  "debug.slider.wideSplitFactor.hint": "Span width > this × row median glyph width → split at column projection valley (fixes RE-style粘连)",
  "debug.slider.spaceGapFactor.label": "Space factor",
  "debug.slider.spaceGapFactor.hint": "Column gap > this × row median gap → word space",
  "debug.slider.capHeightPercentile.label": "Cap-height percentile",
  "debug.slider.capHeightPercentile.hint": "Uses this percentile's glyph height as the row cap height (affects patch extraction scale)",
  "debug.slider.minGlyphWidth.label": "Min glyph width (px)",
  "debug.slider.minGlyphWidth.hint": "Narrower-and-shorter ones are dropped as noise",
  "debug.slider.minGlyphFgRatio.label": "Foreground ratio floor",
  "debug.slider.minGlyphFgRatio.hint": "Foreground pixels < this × capH² are dropped as noise (still keeps small punctuation like periods)",

  "debug.stats.components": "components",
  "debug.stats.filter": "→ filter",
  "debug.stats.l1Merge": "→ L1 merge",
  "debug.stats.l2Cluster": "→ L2 cluster",
  "debug.stats.summary": "(filtered {filtered}, L1 merged {l1}, L2 merged {l2})",

  "debug.caption.annotated": "Annotated original (green/yellow/red = high/mid/low confidence)",
  "debug.caption.annotatedAlt": "Annotated",
  "debug.caption.preprocessed": "Preprocessed grayscale (CV input)",
  "debug.caption.preprocessedAlt": "Preprocessed",
  "debug.splitModeOn": "Split mode: on",
  "debug.splitModeOff": "Split mode: off",
  "debug.clearSplits": "Clear {count} line(s)",
  "debug.pipelineIntermediate": "Pipeline intermediates",
  "debug.rejectedBlocks": "({count} components filtered)",
  "debug.detectedPatches": "Detected glyph patches ({count})",
  "debug.packNotLoaded": "Pack not loaded",
  "debug.packMeta": "Pack metadata",

  "error.packNotLoaded": "Pack not loaded",
  "error.noImage": "Please provide an image first",

  "locale.toggleTo": "中", // English mode shows this button (click to switch to Chinese)
};

const dicts: Record<Locale, Record<string, string>> = { zh, en };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return s;
}

/** 显式指定 locale 的查找（用于初始化阶段同步 SSR 元数据） */
function tc(key: string, loc: Locale, vars?: Record<string, string | number>): string {
  const dict = dicts[loc] ?? dicts.zh;
  const template = dict[key] ?? dicts.zh[key] ?? key;
  return interpolate(template, vars);
}

/** 非响应式查找。组件内请用 useT()。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return tc(key, $locale.get(), vars);
}

/**
 * 组件内响应式 t 函数。订阅 $locale，切换语言时自动重渲染。
 *
 * 用法：
 *   const t = useT();
 *   <span>{t("input.title")}</span>
 *   <span>{t("encode.renderHint", { pack: name })}</span>
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useStore($locale);
  return (key: string, vars?: Record<string, string | number>): string => {
    locale(); // 触发订阅追踪
    return tc(key, $locale.get(), vars);
  };
}

// 模块加载完成（字典、tc 都已定义）后再对齐 <html lang>。
// 不能放在文件顶部：tc() 引用的 dicts 是 const，处于 TDZ 时调用会抛 ReferenceError，
// 会让整个模块（以及所有 import 它的组件）加载失败，页面变白。
applyHtmlLang($locale.get());
