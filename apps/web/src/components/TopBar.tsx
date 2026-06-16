import { useStore } from "@nanostores/solid";
import { Eye, Github } from "lucide-solid";
import { $loadedPack, $packLoading } from "~/stores/pack";
import GameSelector from "./GameSelector";

export default function TopBar() {
  const pack = useStore($loadedPack);
  const loading = useStore($packLoading);

  return (
    <header class="border-b border-[var(--color-surface)] bg-[var(--color-mantle)]">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div class="flex items-center gap-3">
          <div class="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-surface)] text-[var(--color-accent)] glow">
            <Eye size={20} />
          </div>
          <div>
            <h1 class="text-lg font-semibold tracking-tight">
              GlyphLens
            </h1>
            <p class="text-xs text-muted -mt-0.5">游戏自创文字识别 · 浏览器内推理</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden sm:block text-xs text-muted">
            {loading() && "加载字体包…"}
            {!loading() && pack() && (
              <>
                模型 <span class="text-subtext">{pack()!.meta.model.file_size_kb}KB</span> · 训练精度{" "}
                <span class="text-accent">{(pack()!.meta.model.sanity_accuracy * 100).toFixed(1)}%</span>
              </>
            )}
          </div>
          <GameSelector />
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            class="grid h-9 w-9 place-items-center rounded-lg border border-[var(--color-surface)] text-subtext hover:text-text hover:border-[var(--color-overlay)] transition"
            aria-label="GitHub"
          >
            <Github size={16} />
          </a>
        </div>
      </div>
    </header>
  );
}
