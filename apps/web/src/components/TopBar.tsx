import { useStore } from "@nanostores/solid";
import { $loadedPack, $packLoading } from "~/stores/pack";
import { useT, toggleLocale, $locale } from "~/stores/locale";
import GameSelector from "./GameSelector";

export default function TopBar() {
  const pack = useStore($loadedPack);
  const loading = useStore($packLoading);
  const locale = useStore($locale);
  const t = useT();

  return (
    <header class="border-b border-[var(--color-surface)] bg-[var(--color-mantle)]">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div class="flex items-center gap-3">
          <img
            src="/favicon.svg"
            alt=""
            width={36}
            height={36}
            class="h-9 w-9 rounded-lg"
            decoding="async"
          />
          <div>
            <h1 class="text-lg font-semibold tracking-tight">
              Sigil
            </h1>
            <p class="text-xs text-muted -mt-0.5">{t("topbar.subtitle")}</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden sm:block text-xs text-muted">
            {loading() && t("topbar.loadingPack")}
            {!loading() && pack() && (
              <>
                {t("topbar.model")} <span class="text-subtext">{pack()!.meta.model.file_size_kb}KB</span> · {t("topbar.trainingAccuracy")}{" "}
                <span class="text-accent">{(pack()!.meta.model.sanity_accuracy * 100).toFixed(1)}%</span>
              </>
            )}
          </div>
          <GameSelector />
          <button
            type="button"
            onClick={toggleLocale}
            class="grid h-9 min-w-9 place-items-center rounded-lg border border-[var(--color-surface)] text-subtext hover:text-text hover:border-[var(--color-overlay)] transition text-xs font-semibold"
            aria-label={locale() === "zh" ? "Switch to English" : "切换为中文"}
            title={locale() === "zh" ? "Switch to English" : "切换为中文"}
          >
            {locale() === "zh" ? "EN" : "中"}
          </button>
        </div>
      </div>
    </header>
  );
}
