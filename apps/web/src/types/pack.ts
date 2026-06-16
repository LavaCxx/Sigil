/**
 * 字体包数据结构（与 packs/<game>/meta.json + mapping.json 保持一致）
 *
 * 这是核心抽象：所有游戏都通过同一套结构暴露给识别引擎。
 */

export interface GlyphPackMeta {
  id: string;
  name_zh: string;
  name_en: string;
  abbrev: string;
  version: string;
  created_at: string;
  developer: string;
  script_type: "alphabetic_substitution" | "compound_phonetic" | "other";
  script_features: {
    letter_count: number;
    compound_glyphs: boolean;
    case_sensitive: boolean;
    rtl: boolean;
    has_digits: boolean;
    has_punctuation: boolean;
    has_reject_class?: boolean;
  };
  data_provenance: {
    source: string;
    method: string;
    human_traced: boolean;
    verified_against_real_screenshots: boolean;
  };
  model: {
    framework: "ONNX";
    architecture: string;
    input_size: [number, number];
    params?: number;
    num_classes?: number;
    file_size_kb: number;
    sanity_accuracy: number;
    reject_recall?: number;
  };
  files: {
    model: string;
    mapping: string;
    font: string;
    preview: string;
    templates?: string;
  };
}

export interface GlyphPackMapping {
  letters: string;
  case_sensitive: boolean;
  output_index_to_letter: string[];
  /** 可选：reject 类，softmax argmax 落到这里说明 patch 不是有效字母 */
  reject_class?: {
    index: number;
    label: string;
    render: string;
  };
  /** 可选：低于此 softmax 置信度的 patch 在 UI 上标为 ?（前端使用） */
  confidence_threshold?: number;
  model_input: {
    name: string;
    shape: (number | string)[];
    dtype: string;
    normalization: string;
    color_mode: "grayscale" | "rgb";
    background: "white" | "black";
    foreground: "white" | "black";
    invariant_to_color_polarity: boolean;
  };
  model_output: {
    name: string;
    shape: number[];
    interpretation: string;
  };
}

/** 已经加载到内存里的字体包（含 ONNX session 由 inference 层管理） */
export interface LoadedPack {
  meta: GlyphPackMeta;
  mapping: GlyphPackMapping;
  baseUrl: string;
}

/** 已知字体包注册表项（只含目录与显示名，详情按需懒加载） */
export interface PackRegistryEntry {
  id: string;
  name_zh: string;
  name_en: string;
}

/** 一个被检测出的字符在图像中的位置与识别结果 */
export interface RecognizedGlyph {
  /** 字符在原图中的外接框 (x, y, w, h) */
  bbox: [number, number, number, number];
  /** 识别出的英文字母 */
  letter: string;
  /** softmax 后的置信度 [0, 1] */
  confidence: number;
  /** 备选字符（前 3 名，便于 UI 复审） */
  alternatives: Array<{ letter: string; confidence: number }>;
}

/** 一次识别的完整结果 */
export interface RecognitionResult {
  /** 拼装后的字符串（含空格分词） */
  text: string;
  /** 每个被识别字符的详细信息 */
  glyphs: RecognizedGlyph[];
  /** 整体平均置信度 */
  averageConfidence: number;
  /** 识别耗时（毫秒） */
  elapsedMs: number;
  /** 流水线各阶段耗时（毫秒），便于调试 */
  stageTimings: {
    preprocess: number;
    segment: number;
    classify: number;
    postprocess: number;
  };
  /** 用于调试面板可视化的中间产物 */
  debug?: {
    /** 预处理后的图像 (data URL) */
    preprocessedImageUrl?: string;
    /** 标注了所有检测框的图像 (data URL) */
    annotatedImageUrl?: string;
    /** 每个 glyph 的 64x64 patch 图像 (data URL) */
    patchImages?: string[];
    /** 每个 patch 对应的预测标签（与 patchImages 1:1，含被拒绝的） */
    patchLabels?: Array<{ letter: string; confidence: number; isReject: boolean }>;
    /** 被过滤掉的连通块数量 */
    rejectedCount?: number;
    /** 各阶段组件数量统计 */
    debugStats?: {
      rawComponents: number;
      afterFilter: number;
      afterMergeL1: number;
      afterMergeL2: number;
    };
    /** 翻译后图像（原图上覆盖英文字母） */
    translatedImageUrl?: string;
  };
}

/** 用户当前输入的图像数据 */
export interface InputImage {
  /** 图像数据（HTMLImageElement / ImageBitmap / 用 createImageBitmap 解码后的） */
  bitmap: ImageBitmap;
  /** 用于预览展示的 dataURL/objectURL */
  previewUrl: string;
  /** 来源类型 */
  source: "upload" | "paste" | "screen" | "camera";
  /** 接收时间戳 */
  receivedAt: number;
}
