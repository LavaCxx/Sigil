import { useStore } from "@nanostores/solid";
import { ChevronDown, Gamepad2 } from "lucide-solid";
import { Show, For, createSignal, onMount, onCleanup } from "solid-js";
import {
  $registry,
  $currentPackEntry,
  selectPack,
} from "~/stores/pack";

export default function GameSelector() {
  const registry = useStore($registry);
  const current = useStore($currentPackEntry);
  const [open, setOpen] = createSignal(false);

  let rootRef: HTMLDivElement | undefined;

  function handleDocClick(e: MouseEvent) {
    if (!rootRef) return;
    if (!rootRef.contains(e.target as Node)) {
      setOpen(false);
    }
  }
  onMount(() => document.addEventListener("click", handleDocClick));
  onCleanup(() => document.removeEventListener("click", handleDocClick));

  return (
    <div ref={rootRef} class="relative">
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="flex items-center gap-2 rounded-lg border border-[var(--color-surface)] bg-[var(--color-crust)] px-3 py-1.5 text-sm hover:border-[var(--color-overlay)] transition"
      >
        <Gamepad2 size={14} class="text-accent" />
        <span class="hidden sm:inline text-muted">游戏:</span>
        <Show when={current()} fallback={<span class="text-muted">选择…</span>}>
          {(c) => (
            <span class="font-medium">
              {c().name_zh}
              <span class="ml-1 text-muted text-xs">{c().name_en}</span>
            </span>
          )}
        </Show>
        <ChevronDown size={14} class="text-muted" />
      </button>

      <Show when={open()}>
        <div class="absolute right-0 z-20 mt-2 w-72 panel p-1 glow">
          <For each={registry()}>
            {(entry) => {
              const isCurrent = () => current()?.id === entry.id;
              return (
                <button
                  type="button"
                  onClick={() => {
                    void selectPack(entry.id);
                    setOpen(false);
                  }}
                  class={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    isCurrent()
                      ? "bg-[var(--color-surface)] text-text"
                      : "text-subtext hover:bg-[var(--color-surface)] hover:text-text"
                  }`}
                >
                  <span>
                    <div class="font-medium">{entry.name_zh}</div>
                    <div class="text-xs text-muted">{entry.name_en}</div>
                  </span>
                  {isCurrent() && <span class="text-xs text-accent">已选</span>}
                </button>
              );
            }}
          </For>
          <div class="border-t border-[var(--color-surface)] mt-1 px-3 py-2 text-xs text-muted">
            更多游戏字体包将在后续版本接入
          </div>
        </div>
      </Show>
    </div>
  );
}
