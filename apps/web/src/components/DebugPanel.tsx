import { useStore } from "@nanostores/solid";
import { ChevronDown, ChevronRight, Image as ImageIcon, Settings2, RotateCw } from "lucide-solid";
import { Show, createSignal, For, onMount } from "solid-js";
import ZoomableImage from "./ZoomableImage";
import { $result } from "~/stores/result";
import { $recognizing } from "~/stores/result";
import { $segmentConfig } from "~/stores/segmentConfig";
import { $manualSplitXs, addManualSplit, clearManualSplits } from "~/stores/manualSplits";
import { DEFAULT_SEGMENT_CONFIG, type SegmentConfig } from "~/lib/cv/segment";
import { runRecognition } from "~/stores/result";
import { useT } from "~/stores/locale";

type NumberKey = {
  [K in keyof SegmentConfig]: SegmentConfig[K] extends number ? K : never;
}[keyof SegmentConfig];

interface SliderDef {
  key: NumberKey;
  labelKey: string;
  hintKey: string;
  min: number;
  max: number;
  step: number;
}

interface SliderGroup {
  titleKey: string;
  sliders: SliderDef[];
}

const GROUPS: SliderGroup[] = [
  {
    titleKey: "debug.group.lineDetection",
    sliders: [
      { key: "minLineHeight", labelKey: "debug.slider.minLineHeight.label", hintKey: "debug.slider.minLineHeight.hint", min: 2, max: 24, step: 1 },
      { key: "lineMergeGap", labelKey: "debug.slider.lineMergeGap.label", hintKey: "debug.slider.lineMergeGap.hint", min: 1, max: 20, step: 1 },
    ],
  },
  {
    titleKey: "debug.group.glyphSplit",
    sliders: [
      { key: "mergeGapFactor", labelKey: "debug.slider.mergeGapFactor.label", hintKey: "debug.slider.mergeGapFactor.hint", min: 0.1, max: 1.0, step: 0.05 },
      { key: "intraGlyphGapFloor", labelKey: "debug.slider.intraGlyphGapFloor.label", hintKey: "debug.slider.intraGlyphGapFloor.hint", min: 0, max: 0.3, step: 0.01 },
      { key: "wideSplitFactor", labelKey: "debug.slider.wideSplitFactor.label", hintKey: "debug.slider.wideSplitFactor.hint", min: 1.05, max: 2.0, step: 0.05 },
      { key: "spaceGapFactor", labelKey: "debug.slider.spaceGapFactor.label", hintKey: "debug.slider.spaceGapFactor.hint", min: 1.0, max: 3.0, step: 0.1 },
      { key: "capHeightPercentile", labelKey: "debug.slider.capHeightPercentile.label", hintKey: "debug.slider.capHeightPercentile.hint", min: 0.4, max: 0.95, step: 0.01 },
    ],
  },
  {
    titleKey: "debug.group.noiseFilter",
    sliders: [
      { key: "minGlyphWidth", labelKey: "debug.slider.minGlyphWidth.label", hintKey: "debug.slider.minGlyphWidth.hint", min: 1, max: 12, step: 1 },
      { key: "minGlyphFgRatio", labelKey: "debug.slider.minGlyphFgRatio.label", hintKey: "debug.slider.minGlyphFgRatio.hint", min: 0, max: 0.02, step: 0.001 },
    ],
  },
];

export default function DebugPanel() {
  const result = useStore($result);
  const recognizing = useStore($recognizing);
  const config = useStore($segmentConfig);
  const manualSplits = useStore($manualSplitXs);
  const t = useT();
  const [open, setOpen] = createSignal(false);
  const [showPipeline, setShowPipeline] = createSignal(true);
  const [showParams, setShowParams] = createSignal(true);
  const [showPatches, setShowPatches] = createSignal(true);
  const [splitMode, setSplitMode] = createSignal(false);

  function updateConfig(key: keyof SegmentConfig, value: number | boolean | [number, number]) {
    const next = { ...config() };
    (next as any)[key] = value;
    $segmentConfig.set(next);
  }

  function resetConfig() {
    $segmentConfig.set({ ...DEFAULT_SEGMENT_CONFIG });
  }

  return (
    <div class="panel">
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="flex w-full items-center justify-between px-4 py-3 text-xs uppercase tracking-wide text-subtext hover:text-text transition"
      >
        <span class="flex items-center gap-2">
          <Settings2 size={14} />
          {t("debug.title")}
        </span>
        {open() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <Show when={open()}>
        <div class="border-t border-[var(--color-surface)] p-4 space-y-6">

          {/* 参数调节区 */}
          <section>
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs uppercase tracking-wide text-muted flex items-center gap-2">
                <Settings2 size={12} />
                {t("debug.segmentParams")}
              </h3>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetConfig}
                  class="text-xs text-muted hover:text-text transition"
                >
                  {t("debug.reset")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowParams(!showParams())}
                  class="text-xs text-muted hover:text-text transition"
                >
                  {showParams() ? t("debug.collapse") : t("debug.expand")}
                </button>
              </div>
            </div>
            <Show when={showParams()}>
              <div class="space-y-5">
                <For each={GROUPS}>
                  {(group) => (
                    <div class="space-y-3">
                      <div class="flex items-center gap-2">
                        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-accent">
                          {t(group.titleKey)}
                        </h4>
                      </div>
                      <For each={group.sliders}>
                        {(s) => (
                          <label class="block">
                            <div class="flex items-center justify-between text-xs mb-1">
                              <span class="text-subtext">{t(s.labelKey)}</span>
                              <span class="text-muted font-mono">
                                {typeof (config() as any)[s.key] === "number"
                                  ? Number((config() as any)[s.key]).toFixed(s.step < 0.001 ? 5 : s.step < 1 ? 2 : 1)
                                  : String((config() as any)[s.key])}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={s.min}
                              max={s.max}
                              step={s.step}
                              value={(config() as any)[s.key] as number}
                              onInput={(e) => updateConfig(s.key, parseFloat(e.currentTarget.value))}
                              class="w-full h-1.5 rounded-full appearance-none bg-[var(--color-surface)] accent-[var(--color-blue)]"
                            />
                            <p class="text-[10px] text-muted mt-0.5">{t(s.hintKey)}</p>
                          </label>
                        )}
                      </For>
                    </div>
                  )}
                </For>

                <button
                  type="button"
                  onClick={() => runRecognition()}
                  disabled={recognizing()}
                  class="flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs rounded-md bg-[var(--color-blue)]/20 text-[var(--color-blue)] hover:bg-[var(--color-blue)]/30 transition disabled:opacity-40"
                >
                  <RotateCw size={12} class={recognizing() ? "animate-spin" : ""} />
                  {recognizing() ? t("input.recognizing") : t("debug.rerun")}
                </button>

                {/* 分割统计 */}
                <Show when={result()?.debug?.debugStats}>
                  {(stats) => (
                    <div class="flex flex-wrap items-center gap-2 mt-2 px-3 py-2 rounded-md bg-[var(--color-surface)] text-xs font-mono">
                      <span class="text-muted">{t("debug.stats.components")}</span>
                      <span>{stats().rawComponents}</span>
                      <span class="text-muted">{t("debug.stats.filter")}</span>
                      <span>{stats().afterFilter}</span>
                      <span class="text-muted">{t("debug.stats.l1Merge")}</span>
                      <span>{stats().afterMergeL1}</span>
                      <span class="text-muted">{t("debug.stats.l2Cluster")}</span>
                      <span class="text-text font-bold">{stats().afterMergeL2}</span>
                      <span class="text-muted">
                        {t("debug.stats.summary", {
                          filtered: stats().rawComponents - stats().afterFilter,
                          l1: stats().afterFilter - stats().afterMergeL1,
                          l2: stats().afterMergeL1 - stats().afterMergeL2,
                        })}
                      </span>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          </section>

          {/* 中间图像 */}
          <Show when={result()?.debug}>
            {(dbg) => (
              <section>
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-xs uppercase tracking-wide text-muted flex items-center gap-2">
                    <ImageIcon size={12} />
                    {t("debug.pipelineIntermediate")}
                    <Show when={dbg().rejectedCount != null}>
                      <span class="text-[10px]">{t("debug.rejectedBlocks", { count: dbg().rejectedCount ?? 0 })}</span>
                    </Show>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowPipeline(!showPipeline())}
                    class="text-xs text-muted hover:text-text transition"
                  >
                    {showPipeline() ? t("debug.collapse") : t("debug.expand")}
                  </button>
                </div>
                <Show when={showPipeline()}>
                  <div class="grid gap-4 md:grid-cols-2">
                    <Show when={dbg().annotatedImageUrl}>
                      {(url) => (
                        <figure class="rounded-lg overflow-hidden border border-[var(--color-surface)] bg-[var(--color-mantle)] md:col-span-2">
                          <figcaption class="px-3 py-1.5 text-xs text-muted border-b border-[var(--color-surface)]">
                            {t("debug.caption.annotated")}
                          </figcaption>
                          <div class="p-2">
                            <ZoomableImage src={url()} alt={t("debug.caption.annotatedAlt")} maxHeight="480px" />
                          </div>
                        </figure>
                      )}
                    </Show>
                    <Show when={dbg().preprocessedImageUrl}>
                      {(url) => (
                        <figure class="rounded-lg overflow-hidden border border-[var(--color-surface)] bg-[var(--color-mantle)] md:col-span-2">
                          <figcaption class="px-3 py-1.5 text-xs text-muted border-b border-[var(--color-surface)] flex items-center justify-between gap-2">
                            <span>{t("debug.caption.preprocessed")}</span>
                            <span class="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSplitMode(!splitMode())}
                                class={`text-[10px] px-2 py-0.5 rounded transition ${splitMode() ? "bg-[var(--color-blue)]/25 text-[var(--color-blue)]" : "bg-[var(--color-surface)] text-muted hover:text-text"}`}
                              >
                                {splitMode() ? t("debug.splitModeOn") : t("debug.splitModeOff")}
                              </button>
                              <Show when={manualSplits().length > 0}>
                                <button
                                  type="button"
                                  onClick={() => { clearManualSplits(); void runRecognition(); }}
                                  class="text-[10px] px-2 py-0.5 rounded bg-[var(--color-surface)] text-muted hover:text-[var(--color-accent-red)] transition"
                                >
                                  {t("debug.clearSplits", { count: manualSplits().length })}
                                </button>
                              </Show>
                            </span>
                          </figcaption>
                          <div class="p-2 grid place-items-center bg-[var(--color-base)]/40">
                            <PreprocessedSplitEditor
                              url={url()}
                              splitMode={splitMode}
                              splits={manualSplits}
                              onAddSplit={addManualSplit}
                            />
                          </div>
                        </figure>
                      )}
                    </Show>
                  </div>
                </Show>
              </section>
            )}
          </Show>

          {/* Patch 可视化 */}
          <Show when={result()?.debug?.patchImages?.length ? result()?.debug?.patchImages : null}>
            {(patches) => (
              <section>
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-xs uppercase tracking-wide text-muted flex items-center gap-2">
                    <ImageIcon size={12} />
                    {t("debug.detectedPatches", { count: patches().length })}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowPatches(!showPatches())}
                    class="text-xs text-muted hover:text-text transition"
                  >
                    {showPatches() ? t("debug.collapse") : t("debug.expand")}
                  </button>
                </div>
                <Show when={showPatches()}>
                  <div class="flex flex-wrap gap-2">
                    <For each={patches()}>
                      {(url, i) => {
                        const labels = result()?.debug?.patchLabels;
                        const lbl = labels?.[i()];
                        const glyphs = result()?.glyphs;
                        const g = glyphs?.[i()];
                        const label = lbl ?? g;
                        const isReject = lbl?.isReject ?? false;
                        return (
                          <div class="flex flex-col items-center gap-1">
                            <div class="w-12 h-12 rounded border border-[var(--color-surface)] bg-[var(--color-base)]/60 overflow-hidden image-rendering-pixelated" classList={{ "opacity-40": isReject }}>
                              <img src={url} alt={`patch-${i()}`} class="w-full h-full" style={{ "image-rendering": "pixelated" }} />
                            </div>
                            <Show when={label} fallback={<span class="text-[10px] text-muted">?</span>}>
                              {(item) => (
                                <span class="text-[10px] font-mono" classList={{
                                  "text-red-400/50 line-through": isReject,
                                  "text-green-400": !isReject && item().confidence >= 0.9,
                                  "text-yellow-400": !isReject && item().confidence >= 0.7 && item().confidence < 0.9,
                                  "text-red-400": !isReject && item().confidence < 0.7,
                                }}>
                                  {item().letter} {(item().confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function PreprocessedSplitEditor(props: {
  url: string;
  splitMode: () => boolean;
  splits: () => number[];
  onAddSplit: (normX: number) => void;
}) {
  const t = useT();
  let imgEl: HTMLImageElement | undefined;
  let wrapEl: HTMLDivElement | undefined;
  const [layout, setLayout] = createSignal({ ox: 0, dw: 1 });

  function refreshLayout() {
    if (!imgEl) return;
    const rect = imgEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) return;
    const scale = Math.min(rect.width / nw, rect.height / nh);
    const dw = nw * scale;
    setLayout({ ox: (rect.width - dw) / 2, dw });
  }

  onMount(() => {
    const ro = typeof ResizeObserver !== "undefined" && wrapEl
      ? new ResizeObserver(() => refreshLayout())
      : null;
    ro?.observe(wrapEl!);
    return () => ro?.disconnect();
  });

  function imageNormX(clientX: number, clientY: number): number | null {
    if (!imgEl) return null;
    const rect = imgEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) return null;
    const scale = Math.min(rect.width / nw, rect.height / nh);
    const dw = nw * scale;
    const dh = nh * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;
    const lx = clientX - rect.left - ox;
    const ly = clientY - rect.top - oy;
    if (lx < 0 || ly < 0 || lx > dw || ly > dh) return null;
    return lx / dw;
  }

  function onPointerDown(e: PointerEvent) {
    if (!props.splitMode()) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const x = imageNormX(e.clientX, e.clientY);
    if (x != null) props.onAddSplit(x);
  }

  return (
    <div ref={wrapEl} class="relative inline-block leading-none max-w-full">
      <img
        ref={imgEl}
        src={props.url}
        alt={t("debug.caption.preprocessedAlt")}
        draggable={false}
        onLoad={refreshLayout}
        class={`max-w-full max-h-[360px] object-contain block select-none ${props.splitMode() ? "ring-1 ring-[var(--color-blue)]/40" : ""}`}
      />
      <Show when={props.splitMode()}>
        <div
          class="absolute inset-0 cursor-crosshair z-10"
          style={{ "touch-action": "none" }}
          onPointerDown={onPointerDown}
        />
      </Show>
      <For each={props.splits()}>
        {(x) => (
          <div
            class="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent-red)] pointer-events-none z-20"
            style={{ left: `${layout().ox + x() * layout().dw}px` }}
          />
        )}
      </For>
    </div>
  );
}
