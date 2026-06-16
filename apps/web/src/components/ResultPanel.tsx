import { useStore } from "@nanostores/solid";
import { AlertCircle, Copy, Download, FileText, Image as ImageIcon, Languages, Loader2, Sparkles, Type } from "lucide-solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import { $loadedPack } from "~/stores/pack";
import { $currentInput } from "~/stores/input";
import {
  $recognitionStage,
  $recognizeError,
  $recognizing,
  $result,
  $translation,
  $translating,
  $translateError,
} from "~/stores/result";
import { renderTranslatedImageBlob, renderChineseTranslatedImage, renderChineseTranslatedImageBlob } from "~/lib/cv/inpaint";
import type { PipelineStage } from "~/lib/pipeline";

const STAGE_LABELS: Record<PipelineStage, string> = {
  "loading-cv": "加载 OpenCV.js（首次约 3-8 秒）",
  preprocess: "图像预处理 · 灰度 + 二值化",
  segment: "字符分割 · 连通域分析",
  "loading-model": "加载 ONNX 模型",
  classify: "神经网络推理",
  postprocess: "拼装结果",
};

type ViewTab = "text" | "chinese" | "image-en" | "image-zh";

export default function ResultPanel() {
  const result = useStore($result);
  const recognizing = useStore($recognizing);
  const stage = useStore($recognitionStage);
  const error = useStore($recognizeError);
  const pack = useStore($loadedPack);
  const input = useStore($currentInput);
  const translation = useStore($translation);
  const translating = useStore($translating);
  const translateError = useStore($translateError);

  const [copied, setCopied] = createSignal(false);
  const [viewTab, setViewTab] = createSignal<ViewTab>("text");
  const [showOriginal, setShowOriginal] = createSignal(false);
  const [downloading, setDownloading] = createSignal(false);

  const hasTranslatedImage = createMemo(() => !!result()?.debug?.translatedImageUrl);

  const chineseImageUrl = createMemo(() => {
    const inp = input();
    const r = result();
    const t = translation();
    if (!inp || !r || !t || r.glyphs.length === 0) return null;
    return renderChineseTranslatedImage(inp.bitmap, r.glyphs, t.translatedLines);
  });

  function confidenceColor(conf: number): string {
    if (conf >= 0.9) return "text-[var(--color-accent-green)]";
    if (conf >= 0.7) return "text-[var(--color-accent-warm)]";
    return "text-[var(--color-accent-red)]";
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadImage(mode: "en" | "zh") {
    const inp = input();
    const r = result();
    if (!inp || !r || r.glyphs.length === 0) return;
    setDownloading(true);
    try {
      let blob: Blob | null;
      if (mode === "zh") {
        const t = translation();
        if (!t) return;
        blob = await renderChineseTranslatedImageBlob(inp.bitmap, r.glyphs, t.translatedLines);
      } else {
        blob = await renderTranslatedImageBlob(inp.bitmap, r.glyphs);
      }
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `glyphlens-${mode === "zh" ? "chinese" : "english"}-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const sortedTimings = createMemo(() => {
    const r = result();
    if (!r) return [] as Array<[string, number]>;
    return Object.entries(r.stageTimings) as Array<[string, number]>;
  });

  return (
    <div class="panel p-4 flex flex-col gap-4 h-full">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold tracking-wide uppercase text-subtext">
          识别结果
        </h2>
        <div class="flex items-center gap-2">
          <Show when={result()}>
            <div class="flex rounded-md border border-[var(--color-surface)] overflow-hidden text-xs">
              <TabBtn active={viewTab() === "text"} onClick={() => setViewTab("text")}>
                <Type size={10} /> EN
              </TabBtn>
              <TabBtn active={viewTab() === "chinese"} onClick={() => setViewTab("chinese")}>
                <Languages size={10} /> 中文
              </TabBtn>
              <Show when={hasTranslatedImage()}>
                <TabBtn active={viewTab() === "image-en"} onClick={() => setViewTab("image-en")}>
                  <ImageIcon size={10} /> EN图
                </TabBtn>
              </Show>
              <Show when={translation()}>
                <TabBtn active={viewTab() === "image-zh"} onClick={() => setViewTab("image-zh")}>
                  <ImageIcon size={10} /> 中图
                </TabBtn>
              </Show>
            </div>
          </Show>
          <Show when={result() && (viewTab() === "text" || viewTab() === "chinese")}>
            <button
              type="button"
              onClick={() => {
                const tab = viewTab();
                const text = tab === "chinese" ? (translation()?.translatedText ?? "") : (result()?.text ?? "");
                void copyText(text);
              }}
              class="flex items-center gap-1 text-xs text-muted hover:text-text transition"
            >
              <Copy size={12} />
              {copied() ? "已复制" : "复制"}
            </button>
          </Show>
          <Show when={result() && (viewTab() === "image-en" || viewTab() === "image-zh")}>
            <button
              type="button"
              onClick={() => void downloadImage(viewTab() === "image-zh" ? "zh" : "en")}
              disabled={downloading()}
              class="flex items-center gap-1 text-xs text-muted hover:text-text transition disabled:opacity-40"
            >
              <Download size={12} />
              {downloading() ? "生成中…" : "下载"}
            </button>
          </Show>
        </div>
      </div>

      <Show
        when={!recognizing() && !error() && !result()}
        fallback={null}
      >
        <div class="flex-1 min-h-[260px] grid place-items-center text-center px-6">
          <div class="text-muted">
            <Sparkles size={36} class="mx-auto mb-3 opacity-60" />
            <div class="text-sm">提供图片后点击 "开始识别"</div>
            <Show when={pack()}>
              {(p) => (
                <div class="mt-2 text-xs">
                  当前字体包：
                  <span class="text-subtext">{p().meta.name_zh}</span>
                  <span class="ml-1 text-muted">· {p().meta.script_features.letter_count} 字母</span>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={recognizing()}>
        <div class="flex-1 min-h-[260px] grid place-items-center">
          <div class="flex flex-col items-center gap-3 text-subtext">
            <Loader2 size={28} class="animate-spin text-accent" />
            <div class="text-sm">
              {stage() ? STAGE_LABELS[stage()!] : "流水线运行中…"}
            </div>
            <div class="text-xs text-muted">
              预处理 → 分割 → 分类 → 拼装
            </div>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        {(msg) => (
          <div class="flex-1 min-h-[260px] grid place-items-center">
            <div class="flex flex-col items-center gap-3 text-[var(--color-accent-red)] max-w-sm text-center">
              <AlertCircle size={28} />
              <div class="text-sm">{msg()}</div>
            </div>
          </div>
        )}
      </Show>

      <Show when={result()}>
        {(r) => (
          <>
            {/* ── 英文文字 ── */}
            <Show when={viewTab() === "text"}>
              <div class="max-h-[min(52vh,520px)] rounded-xl bg-[var(--color-mantle)] border border-[var(--color-surface)] p-4 overflow-auto">
                <Show
                  when={r().text.length > 0}
                  fallback={
                    <div class="text-sm text-muted italic">
                      未检测到字符。可能：图像中无字体包覆盖的文字，或分割阶段失败。
                    </div>
                  }
                >
                  <pre class={`font-mono tracking-wide leading-relaxed whitespace-pre-wrap break-words text-text ${
                    r().text.length > 80 ? "text-lg" : r().text.length > 40 ? "text-xl" : "text-2xl"
                  }`}>
{r().text}
                  </pre>
                </Show>

                <Show when={r().glyphs.length > 0}>
                  <div class="mt-3 max-h-28 overflow-y-auto flex flex-wrap gap-1">
                    <For each={r().glyphs}>
                      {(glyph) => (
                        <span
                          title={`置信度 ${(glyph.confidence * 100).toFixed(1)}%${glyph.alternatives
                            .map((a) => ` · ${a.letter} ${(a.confidence * 100).toFixed(0)}%`)
                            .join("")}`}
                          class={`${confidenceColor(glyph.confidence)} text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--color-base)]/40 border border-[var(--color-surface)]/60 hover:bg-[var(--color-surface)] transition cursor-default`}
                        >
                          {glyph.letter}
                          <span class="text-muted ml-1">{(glyph.confidence * 100).toFixed(0)}%</span>
                        </span>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="mt-4 pt-4 border-t border-[var(--color-surface)] grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <Stat label="字符数" value={String(r().glyphs.length)} />
                  <Stat
                    label="平均置信度"
                    value={`${(r().averageConfidence * 100).toFixed(1)}%`}
                    valueClass={confidenceColor(r().averageConfidence)}
                  />
                  <Stat label="总耗时" value={`${r().elapsedMs.toFixed(0)} ms`} />
                </div>
              </div>
            </Show>

            {/* ── 中文翻译 ── */}
            <Show when={viewTab() === "chinese"}>
              <div class="flex-1 min-h-[180px] rounded-xl bg-[var(--color-mantle)] border border-[var(--color-surface)] p-5 overflow-auto">
                <Show when={translating()}>
                  <div class="flex items-center gap-2 text-sm text-muted">
                    <Loader2 size={16} class="animate-spin" />
                    正在翻译…
                  </div>
                </Show>
                <Show when={translateError()}>
                  {(msg) => (
                    <div class="flex items-center gap-2 text-sm text-[var(--color-accent-red)]">
                      <AlertCircle size={16} />
                      翻译失败：{msg()}
                    </div>
                  )}
                </Show>
                <Show when={translation()}>
                  {(t) => (
                    <>
                      <pre class="text-2xl leading-relaxed whitespace-pre-wrap break-words text-text">
{t().translatedText}
                      </pre>
                      <div class="mt-4 pt-4 border-t border-[var(--color-surface)]">
                        <div class="text-xs text-muted mb-2">原文 → 翻译 逐句对照（已合并软换行）</div>
                        <div class="space-y-2">
                          <For each={t().sourceLines}>
                            {(srcLine, i) => (
                              <div class="rounded bg-[var(--color-base)]/40 px-3 py-2 text-xs">
                                <div class="text-muted font-mono">{srcLine}</div>
                                <div class="text-text mt-1">{t().translatedLines[i()] ?? ""}</div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </>
                  )}
                </Show>
                <Show when={!translating() && !translateError() && !translation()}>
                  <div class="text-sm text-muted italic">
                    识别完成后将自动翻译为中文
                  </div>
                </Show>
              </div>
            </Show>

            {/* ── 英文译图 ── */}
            <Show when={viewTab() === "image-en"}>
              <ImageCompareView
                imageUrl={r().debug?.translatedImageUrl}
                originalUrl={input()?.previewUrl}
                loading={!hasTranslatedImage()}
                showOriginal={showOriginal}
                setShowOriginal={setShowOriginal}
                label="英文"
              />
            </Show>

            {/* ── 中文译图 ── */}
            <Show when={viewTab() === "image-zh"}>
              <ImageCompareView
                imageUrl={chineseImageUrl()}
                originalUrl={input()?.previewUrl}
                loading={!chineseImageUrl()}
                showOriginal={showOriginal}
                setShowOriginal={setShowOriginal}
                label="中文"
              />
            </Show>

            <div class="rounded-lg bg-[var(--color-mantle)]/40 border border-[var(--color-surface)]/50 p-3">
              <div class="flex items-center gap-2 mb-2">
                <FileText size={12} class="text-muted" />
                <span class="text-xs text-muted">流水线耗时</span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <For each={sortedTimings()}>
                  {([stage, ms]) => (
                    <div class="rounded bg-[var(--color-base)]/40 px-2 py-1.5">
                      <div class="text-muted">{stage}</div>
                      <div class="font-mono text-subtext">{ms.toFixed(0)} ms</div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

// ─── 子组件 ───────────────────────────────────────────────────────────────

function TabBtn(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`flex items-center gap-1 px-2 py-1 transition ${
        props.active
          ? "bg-[var(--color-surface)] text-text"
          : "text-muted hover:text-subtext"
      }`}
    >
      {props.children}
    </button>
  );
}

function ImageCompareView(props: {
  imageUrl: string | null | undefined;
  originalUrl: string | undefined;
  loading: boolean;
  showOriginal: () => boolean;
  setShowOriginal: (fn: (prev: boolean) => boolean) => void;
  label: string;
}) {
  return (
    <div class="flex-1 min-h-[180px] rounded-xl bg-[var(--color-mantle)] border border-[var(--color-surface)] overflow-hidden flex flex-col">
      <Show
        when={!props.loading && props.imageUrl}
        fallback={
          <div class="flex-1 grid place-items-center p-5">
            <div class="text-sm text-muted italic flex flex-col items-center gap-2">
              <Loader2 size={20} class="animate-spin opacity-60" />
              {props.label}译图生成中…
            </div>
          </div>
        }
      >
        <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-surface)]">
          <span class="text-xs text-muted">
            {props.showOriginal() ? "原图" : `${props.label}翻译`}
          </span>
          <label class="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
            <span>原图对比</span>
            <button
              type="button"
              onClick={() => props.setShowOriginal((v) => !v)}
              class={`relative w-8 h-4.5 rounded-full transition-colors ${
                props.showOriginal()
                  ? "bg-[var(--color-accent)]"
                  : "bg-[var(--color-surface)]"
              }`}
            >
              <span
                class={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                  props.showOriginal() ? "translate-x-3.5" : ""
                }`}
              />
            </button>
          </label>
        </div>
        <div class="flex-1 grid place-items-center p-2 bg-[var(--color-base)]/40">
          <Show
            when={!props.showOriginal()}
            fallback={
              <img
                src={props.originalUrl}
                alt="原图"
                class="max-h-[420px] max-w-full object-contain rounded"
              />
            }
          >
            <img
              src={props.imageUrl!}
              alt={`${props.label}翻译图像`}
              class="max-h-[420px] max-w-full object-contain rounded"
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function Stat(props: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div class="text-muted">{props.label}</div>
      <div class={`font-mono ${props.valueClass ?? "text-text"}`}>{props.value}</div>
    </div>
  );
}
