import { Show, createSignal, onMount } from "solid-js";

/** 可滚轮缩放 + 拖拽平移的图片查看器，用于 debug 切分示意图 */
export default function ZoomableImage(props: {
  src: string;
  alt: string;
  maxHeight?: string;
  class?: string;
}) {
  const [scale, setScale] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  let dragging = false;
  let last = { x: 0, y: 0 };
  let viewportEl: HTMLDivElement | undefined;

  function reset() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  onMount(() => {
    const el = viewportEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((s) => {
        const next = Math.min(10, Math.max(1, s * factor));
        if (next <= 1.02) reset();
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(e: PointerEvent) {
    if (scale() <= 1) return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onPointerUp() {
    dragging = false;
  }

  return (
    <div class="flex flex-col gap-1.5 w-full">
      <div class="flex items-center justify-between text-[10px] text-muted px-0.5">
        <span>滚轮缩放 · 放大后可拖拽</span>
        <Show when={scale() > 1}>
          <button
            type="button"
            onClick={reset}
            class="px-2 py-0.5 rounded bg-[var(--color-surface)] hover:text-text transition"
          >
            重置视图
          </button>
        </Show>
      </div>
      <div
        ref={viewportEl}
        class="relative overflow-hidden rounded bg-[var(--color-base)]/40 border border-[var(--color-surface)]/50 w-full"
        style={{ "max-height": props.maxHeight ?? "420px", cursor: scale() > 1 ? "grab" : "zoom-in" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDblClick={reset}
      >
        <div
          class="grid place-items-center min-h-[120px] p-2"
          style={{
            transform: `translate(${pan().x}px, ${pan().y}px) scale(${scale()})`,
            "transform-origin": "center center",
          }}
        >
          <img
            src={props.src}
            alt={props.alt}
            draggable={false}
            class={`max-w-none select-none ${props.class ?? ""}`}
            style={{ "max-height": props.maxHeight ?? "400px", width: "auto" }}
          />
        </div>
      </div>
    </div>
  );
}
