import { useStore } from "@nanostores/solid";
import {
  Camera,
  ClipboardPaste,
  ImageUp,
  Monitor,
  Trash2,
  Wand2,
} from "lucide-solid";
import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import {
  $currentInput,
  $roi,
  clearInput,
  ingestImage,
  setRoi,
  type NormalizedRoi,
} from "~/stores/input";
import { $loadedPack, $packLoading } from "~/stores/pack";
import { $recognizing, runRecognition } from "~/stores/result";
import { useT } from "~/stores/locale";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/avif";

export default function InputPanel() {
  const input = useStore($currentInput);
  const roi = useStore($roi);
  const pack = useStore($loadedPack);
  const packLoading = useStore($packLoading);
  const recognizing = useStore($recognizing);
  const t = useT();

  const [dragging, setDragging] = createSignal(false);
  const [pasteHint, setPasteHint] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;
  let cameraInputRef: HTMLInputElement | undefined;

  async function handleFiles(files: FileList | null, source: "upload" | "camera") {
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (!file.type.startsWith("image/")) {
      setPasteHint(t("input.imageOnlyError", { type: file.type || t("input.unknownType") }));
      setTimeout(() => setPasteHint(null), 3000);
      return;
    }
    await ingestImage(file, source);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files) {
      void handleFiles(e.dataTransfer.files, "upload");
    }
  }

  async function handlePasteButton() {
    try {
      if (!navigator.clipboard?.read) {
        setPasteHint(t("input.clipboardNotSupported"));
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          await ingestImage(blob, "paste");
          return;
        }
      }
      setPasteHint(t("input.noImageInClipboard"));
      setTimeout(() => setPasteHint(null), 2500);
    } catch (err) {
      setPasteHint(err instanceof Error ? err.message : String(err));
      setTimeout(() => setPasteHint(null), 4000);
    }
  }

  async function handleScreenCapture() {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setPasteHint(t("input.screenCaptureNotSupported"));
        setTimeout(() => setPasteHint(null), 3000);
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" } as MediaTrackConstraints,
        audio: false,
      });
      const track = stream.getVideoTracks()[0]!;
      const ImageCaptureCtor = (globalThis as unknown as {
        ImageCapture?: new (track: MediaStreamTrack) => {
          grabFrame: () => Promise<ImageBitmap>;
        };
      }).ImageCapture;
      if (ImageCaptureCtor) {
        const capture = new ImageCaptureCtor(track);
        const bitmap = await capture.grabFrame();
        track.stop();
        const blob = await bitmapToBlob(bitmap);
        await ingestImage(blob, "screen");
      } else {
        // Safari 等不支持 ImageCapture 时退回 video -> canvas
        const video = document.createElement("video");
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        track.stop();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 返回空"))), "image/png")
        );
        await ingestImage(blob, "screen");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/dismissed|cancel|denied/i.test(msg)) {
        setPasteHint(msg);
        setTimeout(() => setPasteHint(null), 4000);
      }
    }
  }

  async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 返回空"))), "image/png")
    );
  }

  function onWindowPaste(e: ClipboardEvent) {
    if (!e.clipboardData) return;
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          void ingestImage(file, "paste");
          e.preventDefault();
          return;
        }
      }
    }
  }
  onMount(() => window.addEventListener("paste", onWindowPaste));
  onCleanup(() => window.removeEventListener("paste", onWindowPaste));

  const canRecognize = () =>
    !!input() && !!pack() && !packLoading() && !recognizing();

  return (
    <div class="panel p-4 flex flex-col gap-4 h-full">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold tracking-wide uppercase text-subtext">
          {t("input.title")}
        </h2>
        <Show when={input()}>
          <button
            type="button"
            onClick={clearInput}
            class="flex items-center gap-1 text-xs text-muted hover:text-[var(--color-accent-red)] transition"
          >
            <Trash2 size={12} />
            {t("input.clear")}
          </button>
        </Show>
      </div>

      <Show
        when={input()}
        fallback={
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            class={`flex-1 min-h-[260px] rounded-xl border-2 border-dashed transition flex flex-col items-center justify-center gap-3 px-6 text-center ${
              dragging()
                ? "border-[var(--color-accent)] bg-[var(--color-surface)]/40"
                : "border-[var(--color-surface)] bg-[var(--color-mantle)]/40"
            }`}
          >
            <ImageUp size={42} class="text-accent opacity-80" />
            <div>
              <div class="text-sm">{t("input.dropHint")}</div>
              <div class="text-xs text-muted mt-1">
                {t("input.dropSubhint")}
              </div>
            </div>
          </div>
        }
      >
        {(img) => (
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2 text-xs text-muted px-0.5">
              <span>{roi() ? t("input.roiSelected") : t("input.roiHint")}</span>
              <Show when={roi()}>
                <button
                  type="button"
                  onClick={() => setRoi(null)}
                  class="shrink-0 px-2 py-0.5 rounded border border-[var(--color-surface)] text-subtext hover:text-[var(--color-accent-red)] transition"
                >
                  {t("input.clearRoi")}
                </button>
              </Show>
            </div>
            <div class="rounded-xl bg-[var(--color-mantle)]/60 border border-[var(--color-surface)] overflow-hidden grid place-items-center p-2 max-h-[min(52vh,480px)] overflow-y-auto">
              <RoiSelector previewUrl={img().previewUrl} />
            </div>
          </div>
        )}
      </Show>

      <Show when={pasteHint()}>
        {(hint) => (
          <div class="text-xs text-[var(--color-accent-warm)] bg-[var(--color-mantle)] border border-[var(--color-surface)] rounded-md px-3 py-2">
            {hint()}
          </div>
        )}
      </Show>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input
          ref={fileInputRef}
          type="file"
          class="hidden"
          accept={ACCEPTED_TYPES}
          onChange={(e) => handleFiles(e.currentTarget.files, "upload")}
        />
        <input
          ref={cameraInputRef}
          type="file"
          class="hidden"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFiles(e.currentTarget.files, "camera")}
        />
        <ActionButton icon={<ImageUp size={16} />} label={t("input.upload")} onClick={() => fileInputRef?.click()} />
        <ActionButton icon={<ClipboardPaste size={16} />} label={t("input.paste")} onClick={handlePasteButton} />
        <ActionButton icon={<Monitor size={16} />} label={t("input.capture")} onClick={handleScreenCapture} />
        <ActionButton icon={<Camera size={16} />} label={t("input.camera")} onClick={() => cameraInputRef?.click()} />
      </div>

      <button
        type="button"
        disabled={!canRecognize()}
        onClick={runRecognition}
        class={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition ${
          canRecognize()
            ? "bg-[var(--color-accent)] text-[var(--color-base)] hover:brightness-110 glow"
            : "bg-[var(--color-surface)] text-muted cursor-not-allowed"
        }`}
      >
        <Wand2 size={16} />
        {recognizing() ? t("input.recognizing") : t("input.startRecognize")}
      </button>
    </div>
  );
}

/**
 * 在预览图上拖拽框选 ROI。整屏截图里文字只占一小块时，框出文字区域可大幅提升识别。
 * 不框选则默认识别整图（理想截图行为不变）。
 * 坐标以归一化 [0,1] 存入 $roi；元素盒等于渲染图(object-contain 自适应)，故用百分比定位。
 */
function RoiSelector(props: { previewUrl: string }) {
  const roi = useStore($roi);
  const t = useT();
  const [draft, setDraft] = createSignal<NormalizedRoi | null>(null);
  const [layout, setLayout] = createSignal({ ox: 0, oy: 0, dw: 1, dh: 1 });
  let imgEl: HTMLImageElement | undefined;
  let wrapEl: HTMLDivElement | undefined;
  let dragging = false;
  let start = { x: 0, y: 0 };

  function refreshLayout() {
    if (!imgEl) return;
    const rect = imgEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) return;
    const s = Math.min(rect.width / nw, rect.height / nh);
    const dw = nw * s;
    const dh = nh * s;
    setLayout({ ox: (rect.width - dw) / 2, oy: (rect.height - dh) / 2, dw, dh });
  }

  onMount(() => {
    const ro = typeof ResizeObserver !== "undefined" && wrapEl
      ? new ResizeObserver(() => refreshLayout())
      : null;
    ro?.observe(wrapEl!);
    return () => ro?.disconnect();
  });

  function toNorm(e: PointerEvent): { x: number; y: number } | null {
    if (!imgEl) return null;
    const rect = imgEl.getBoundingClientRect();
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (!nw || !nh) return null;
    const s = Math.min(rect.width / nw, rect.height / nh);
    const dw = nw * s;
    const dh = nh * s;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;
    const lx = e.clientX - rect.left - ox;
    const ly = e.clientY - rect.top - oy;
    if (lx < 0 || ly < 0 || lx > dw || ly > dh) return null;
    return { x: lx / dw, y: ly / dh };
  }

  function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): NormalizedRoi {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !imgEl) return;
    const p = toNorm(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    start = p;
    setDraft({ ...start, w: 0, h: 0 });
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const p = toNorm(e);
    if (!p) return;
    setDraft(rectFrom(start, p));
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const p = toNorm(e);
    if (!p) {
      setDraft(null);
      return;
    }
    const r = rectFrom(start, p);
    setDraft(null);
    if (r.w >= 0.02 && r.h >= 0.02) setRoi(r);
    else setRoi(null);
  }

  const active = () => draft() ?? roi();

  function roiStyle(r: NormalizedRoi) {
    const l = layout();
    return {
      left: `${l.ox + r.x * l.dw}px`,
      top: `${l.oy + r.y * l.dh}px`,
      width: `${r.w * l.dw}px`,
      height: `${r.h * l.dh}px`,
    };
  }

  return (
    <div ref={wrapEl} class="relative inline-block leading-none max-w-full">
      <img
        ref={imgEl}
        src={props.previewUrl}
        alt={t("input.altPending")}
        draggable={false}
        onLoad={refreshLayout}
        class="max-h-[min(48vh,440px)] max-w-full object-contain block select-none"
      />
      <div
        class="absolute inset-0 cursor-crosshair"
        style={{ "touch-action": "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Show when={active()}>
          {(r) => (
            <div
              class="absolute border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/15 pointer-events-none"
              style={roiStyle(r())}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

function ActionButton(props: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-surface)] bg-[var(--color-mantle)] px-3 py-2 text-xs text-subtext hover:text-text hover:border-[var(--color-overlay)] hover:bg-[var(--color-surface)] transition"
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
