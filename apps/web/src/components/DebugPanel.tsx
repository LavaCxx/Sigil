import { useStore } from "@nanostores/solid";
import { ChevronDown, ChevronRight, Image as ImageIcon, Settings2, RotateCw } from "lucide-solid";
import { Show, createSignal, For, onMount } from "solid-js";
import ZoomableImage from "./ZoomableImage";
import { $loadedPack } from "~/stores/pack";
import { $result } from "~/stores/result";
import { $recognizing } from "~/stores/result";
import { $segmentConfig } from "~/stores/segmentConfig";
import { $manualSplitXs, addManualSplit, clearManualSplits } from "~/stores/manualSplits";
import { DEFAULT_SEGMENT_CONFIG, type SegmentConfig } from "~/lib/cv/segment";
import { runRecognition } from "~/stores/result";

type NumberKey = {
  [K in keyof SegmentConfig]: SegmentConfig[K] extends number ? K : never;
}[keyof SegmentConfig];

interface SliderDef {
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

interface SliderGroup {
  title: string;
  sliders: SliderDef[];
}

const GROUPS: SliderGroup[] = [
  {
    title: "行检测（水平投影）",
    sliders: [
      { key: "minLineHeight", label: "行带最小高度(px)", min: 2, max: 24, step: 1, hint: "行带高度低于此值视为噪点行丢弃" },
      { key: "lineMergeGap", label: "行带合并间距(px)", min: 1, max: 20, step: 1, hint: "相邻行带垂直间距 < 此值时合并为同一行（处理笔画断裂）" },
    ],
  },
  {
    title: "字形切分（列投影 · 自适应间隙）",
    sliders: [
      { key: "mergeGapFactor", label: "同字合并系数", min: 0.1, max: 1.0, step: 0.05, hint: "列间隙 < 此系数 × 行中位列间隙 → 视为同一个字的多笔画。越大越爱合并" },
      { key: "intraGlyphGapFloor", label: "同字合并地板(×行高)", min: 0, max: 0.3, step: 0.01, hint: "列间隙 < 此系数 × 行高 → 一定合并。默认已降至 0.08；低清图若仍整词粘连，优先用过宽拆分或手动竖线" },
      { key: "wideSplitFactor", label: "过宽自动拆分(×中位字宽)", min: 1.05, max: 2.0, step: 0.05, hint: "span 宽度 > 此倍数 × 行内中位字宽 → 在列投影谷底切开（专治 RE 粘连）" },
      { key: "spaceGapFactor", label: "空格系数", min: 1.0, max: 3.0, step: 0.1, hint: "列间隙 > 此系数 × 行中位列间隙 → 词间空格" },
      { key: "capHeightPercentile", label: "字高估计百分位", min: 0.4, max: 0.95, step: 0.01, hint: "用该百分位的字高作为行大写字高（影响 patch 抽取尺度）" },
    ],
  },
  {
    title: "噪点过滤",
    sliders: [
      { key: "minGlyphWidth", label: "字形最小宽度(px)", min: 1, max: 12, step: 1, hint: "更窄且更矮的视为噪点丢弃" },
      { key: "minGlyphFgRatio", label: "前景占比下限", min: 0, max: 0.02, step: 0.001, hint: "前景像素 < 此值 × capH² 视为噪点（仍保留句号等小标点）" },
    ],
  },
];

export default function DebugPanel() {
  const pack = useStore($loadedPack);
  const result = useStore($result);
  const recognizing = useStore($recognizing);
  const config = useStore($segmentConfig);
  const manualSplits = useStore($manualSplitXs);
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
          调试 / 参数调节
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
                分割参数
              </h3>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetConfig}
                  class="text-xs text-muted hover:text-text transition"
                >
                  重置默认
                </button>
                <button
                  type="button"
                  onClick={() => setShowParams(!showParams())}
                  class="text-xs text-muted hover:text-text transition"
                >
                  {showParams() ? "折叠" : "展开"}
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
                          {group.title}
                        </h4>
                      </div>
                      <For each={group.sliders}>
                        {(s) => (
                          <label class="block">
                            <div class="flex items-center justify-between text-xs mb-1">
                              <span class="text-subtext">{s.label}</span>
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
                            <p class="text-[10px] text-muted mt-0.5">{s.hint}</p>
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
                  {recognizing() ? "识别中…" : "重新识别"}
                </button>

                {/* 分割统计 */}
                <Show when={result()?.debug?.debugStats}>
                  {(stats) => (
                    <div class="flex flex-wrap items-center gap-2 mt-2 px-3 py-2 rounded-md bg-[var(--color-surface)] text-xs font-mono">
                      <span class="text-muted">连通块</span>
                      <span>{stats().rawComponents}</span>
                      <span class="text-muted">→ 过滤</span>
                      <span>{stats().afterFilter}</span>
                      <span class="text-muted">→ L1合并</span>
                      <span>{stats().afterMergeL1}</span>
                      <span class="text-muted">→ L2聚类</span>
                      <span class="text-text font-bold">{stats().afterMergeL2}</span>
                      <span class="text-muted">
                        (滤掉 {stats().rawComponents - stats().afterFilter}，
                        L1 合并 {stats().afterFilter - stats().afterMergeL1}，
                        L2 合并 {stats().afterMergeL1 - stats().afterMergeL2})
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
                    流水线中间产物
                    <Show when={dbg().rejectedCount != null}>
                      <span class="text-[10px]">(过滤掉 {dbg().rejectedCount} 个连通块)</span>
                    </Show>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowPipeline(!showPipeline())}
                    class="text-xs text-muted hover:text-text transition"
                  >
                    {showPipeline() ? "折叠" : "展开"}
                  </button>
                </div>
                <Show when={showPipeline()}>
                  <div class="grid gap-4 md:grid-cols-2">
                    <Show when={dbg().annotatedImageUrl}>
                      {(url) => (
                        <figure class="rounded-lg overflow-hidden border border-[var(--color-surface)] bg-[var(--color-mantle)] md:col-span-2">
                          <figcaption class="px-3 py-1.5 text-xs text-muted border-b border-[var(--color-surface)]">
                            标注后的原图（绿/黄/红 = 高/中/低置信度）
                          </figcaption>
                          <div class="p-2">
                            <ZoomableImage src={url()} alt="标注图" maxHeight="480px" />
                          </div>
                        </figure>
                      )}
                    </Show>
                    <Show when={dbg().preprocessedImageUrl}>
                      {(url) => (
                        <figure class="rounded-lg overflow-hidden border border-[var(--color-surface)] bg-[var(--color-mantle)] md:col-span-2">
                          <figcaption class="px-3 py-1.5 text-xs text-muted border-b border-[var(--color-surface)] flex items-center justify-between gap-2">
                            <span>预处理灰度图（CV 输入）</span>
                            <span class="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSplitMode(!splitMode())}
                                class={`text-[10px] px-2 py-0.5 rounded transition ${splitMode() ? "bg-[var(--color-blue)]/25 text-[var(--color-blue)]" : "bg-[var(--color-surface)] text-muted hover:text-text"}`}
                              >
                                {splitMode() ? "切分模式：开" : "切分模式：关"}
                              </button>
                              <Show when={manualSplits().length > 0}>
                                <button
                                  type="button"
                                  onClick={() => { clearManualSplits(); void runRecognition(); }}
                                  class="text-[10px] px-2 py-0.5 rounded bg-[var(--color-surface)] text-muted hover:text-[var(--color-accent-red)] transition"
                                >
                                  清除 {manualSplits().length} 条竖线
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
                    检测到的 glyph patches（{patches().length} 个）
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowPatches(!showPatches())}
                    class="text-xs text-muted hover:text-text transition"
                  >
                    {showPatches() ? "折叠" : "展开"}
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

          {/* 字体包信息 */}
          <Show when={pack()} fallback={<div class="text-xs text-muted">未加载字体包</div>}>
            {(p) => (
              <section>
                <h3 class="text-xs uppercase tracking-wide text-muted mb-2">字体包元信息</h3>
                <pre class="text-xs bg-[var(--color-mantle)] border border-[var(--color-surface)] rounded-lg p-3 overflow-auto max-h-64">
{JSON.stringify(p().meta, null, 2)}
                </pre>
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
        alt="预处理图"
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
