import { useStore } from "@nanostores/solid";
import { Copy, Download, Eraser, Loader2, PenLine, Sparkles } from "lucide-solid";
import { Show, createMemo, createResource, createSignal } from "solid-js";
import { $loadedPack } from "~/stores/pack";
import { $encodeText } from "~/stores/encode";
import { ensurePackFont } from "~/lib/packs/font";
import { useT } from "~/stores/locale";
import type { LoadedPack } from "~/types/pack";

/**
 * 转换面板：输入英文 → 用字体包的密文字体渲染为加密文字。
 * 与「识别」同级的功能入口（见 App.tsx 的模式切换）。
 */
export default function EncodePanel() {
  const pack = useStore($loadedPack);
  const text = useStore($encodeText);
  const t = useT();
  const [copied, setCopied] = createSignal(false);
  const [downloading, setDownloading] = createSignal(false);

  // 按当前字体包动态加载密文字体（FontFace API），返回 font-family 名
  const [fontFamily] = createResource(pack, (p) => ensurePackFont(p));

  /** 映射表大小写不敏感时统一转大写（密文字体只覆盖大写字形） */
  const normalized = createMemo(() => {
    const p = pack();
    const raw = text();
    if (!p || p.mapping.case_sensitive) return raw;
    return raw.toUpperCase();
  });

  /** 字体包不覆盖的字符（渲染时会 fallback 成普通字形，提示用户） */
  const unsupportedChars = createMemo(() => {
    const p = pack();
    if (!p) return [];
    const m = p.mapping as unknown as { letters: string; digits?: string; punctuation?: string };
    const supported = new Set(
      (m.letters + (m.digits ?? "") + (m.punctuation ?? "") + " \n\t").split(""),
    );
    return [...new Set(normalized().split(""))].filter((ch) => !supported.has(ch));
  });

  async function copyText() {
    await navigator.clipboard.writeText(normalized());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadImage() {
    const p = pack();
    const family = fontFamily();
    if (!p || !family || !normalized().trim()) return;
    setDownloading(true);
    try {
      const blob = await renderEncodedImageBlob(normalized(), family);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sigil-encoded-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div class="grid gap-6 lg:grid-cols-2">
      {/* ── 英文输入 ── */}
      <div class="panel p-4 flex flex-col gap-4 h-full">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-wide uppercase text-subtext flex items-center gap-2">
            <PenLine size={14} />
            {t("encode.titleInput")}
          </h2>
          <Show when={text().length > 0}>
            <button
              type="button"
              onClick={() => $encodeText.set("")}
              class="flex items-center gap-1 text-xs text-muted hover:text-text transition"
            >
              <Eraser size={12} />
              {t("encode.clear")}
            </button>
          </Show>
        </div>

        <textarea
          value={text()}
          onInput={(e) => $encodeText.set(e.currentTarget.value)}
          placeholder={t("encode.placeholder")}
          spellcheck={false}
          class="flex-1 min-h-[260px] w-full resize-none rounded-xl bg-[var(--color-mantle)] border border-[var(--color-surface)] p-5 text-xl font-mono tracking-wide leading-relaxed text-text placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)] transition"
        />

        <div class="text-xs text-muted">
          <Show
            when={pack()}
            fallback={<span>{t("encode.waitingPack")}</span>}
          >
            {(p) => (
              <>
                {t("encode.renderHint", { pack: p().meta.name_zh })}
                <Show when={!p().mapping.case_sensitive}>
                  <span>{t("encode.caseInsensitive")}</span>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>

      {/* ── 加密文字输出 ── */}
      <div class="panel p-4 flex flex-col gap-4 h-full">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-wide uppercase text-subtext">
            {t("encode.titleOutput")}
          </h2>
          <div class="flex items-center gap-3">
            <Show when={normalized().trim().length > 0}>
              <button
                type="button"
                onClick={() => void copyText()}
                class="flex items-center gap-1 text-xs text-muted hover:text-text transition"
              >
                <Copy size={12} />
                {copied() ? t("result.copied") : t("encode.copyText")}
              </button>
              <button
                type="button"
                onClick={() => void downloadImage()}
                disabled={downloading() || !fontFamily()}
                class="flex items-center gap-1 text-xs text-muted hover:text-text transition disabled:opacity-40"
              >
                <Download size={12} />
                {downloading() ? t("result.generating") : t("encode.downloadImage")}
              </button>
            </Show>
          </div>
        </div>

        <Show
          when={normalized().trim().length > 0}
          fallback={
            <div class="flex-1 min-h-[260px] grid place-items-center text-center px-6">
              <div class="text-muted">
                <Sparkles size={36} class="mx-auto mb-3 opacity-60" />
                <div class="text-sm">{t("encode.outputPlaceholder")}</div>
              </div>
            </div>
          }
        >
          <div class="flex-1 min-h-[260px] rounded-xl bg-[var(--color-mantle)] border border-[var(--color-surface)] p-5 overflow-auto">
            <Show
              when={fontFamily()}
              fallback={
                <div class="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={16} class="animate-spin" />
                  {t("encode.loadingFont")}
                </div>
              }
            >
              {(family) => (
                <pre
                  class="text-4xl tracking-wide leading-relaxed whitespace-pre-wrap break-words text-text"
                  style={{ "font-family": `"${family()}", sans-serif` }}
                >
{normalized()}
                </pre>
              )}
            </Show>
          </div>
        </Show>

        <Show when={unsupportedChars().length > 0}>
          <div class="rounded-lg bg-[var(--color-accent-warm)]/10 border border-[var(--color-accent-warm)]/30 px-3 py-2 text-xs text-[var(--color-accent-warm)]">
            {t("encode.unsupportedHint")}
            <span class="font-mono ml-1">{unsupportedChars().join(" ")}</span>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ─── 图片导出 ────────────────────────────────────────────────────────────────

const EXPORT_FONT_SIZE = 64;
const EXPORT_PADDING = 48;
const EXPORT_LINE_HEIGHT = 1.5;

/** 把加密文字渲染成 PNG（深色底 + 浅色字，与 UI 风格一致） */
async function renderEncodedImageBlob(
  text: string,
  fontFamily: string,
): Promise<Blob | null> {
  const fontSpec = `${EXPORT_FONT_SIZE}px "${fontFamily}", sans-serif`;
  await document.fonts.load(fontSpec);

  const lines = text.split("\n");
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = fontSpec;
  const maxLineWidth = Math.max(
    1,
    ...lines.map((line) => measure.measureText(line).width),
  );

  const lineHeight = EXPORT_FONT_SIZE * EXPORT_LINE_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(maxLineWidth + EXPORT_PADDING * 2);
  canvas.height = Math.ceil(lines.length * lineHeight + EXPORT_PADDING * 2);

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#181825";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = fontSpec;
  ctx.fillStyle = "#cdd6f4";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, EXPORT_PADDING, EXPORT_PADDING + (i + 0.5) * lineHeight);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
