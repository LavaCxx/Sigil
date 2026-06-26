import { Show, onMount } from "solid-js";
import { useStore } from "@nanostores/solid";
import { ScanText, Languages } from "lucide-solid";
import { bootstrapPacks } from "~/stores/pack";
import { $appMode, type AppMode } from "~/stores/mode";
import { useT } from "~/stores/locale";
import { warmupPipeline } from "~/lib/pipeline";
import TopBar from "./TopBar";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import DebugPanel from "./DebugPanel";
import EncodePanel from "./EncodePanel";

/**
 * DebugPanel 仅在以下任一条件成立时渲染：
 * - 开发模式（import.meta.env.DEV，生产构建会被 Vite 替换为 false 并被死代码消除）
 * - URL 带 ?debug=1（允许生产环境也能临时开启调参面板）
 *
 * 默认生产用户看不到分割参数滑块、patch 可视化、字体包元信息等开发期辅助。
 */
function shouldShowDebugPanel(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof location !== "undefined") {
    return new URLSearchParams(location.search).has("debug");
  }
  return false;
}

export default function App() {
  const mode = useStore($appMode);
  const t = useT();
  const showDebug = shouldShowDebugPanel();

  onMount(() => {
    bootstrapPacks();
    // 后台预热 OpenCV（script 标签加载，见 Base.astro）
    warmupPipeline();
  });

  return (
    <div class="min-h-screen flex flex-col">
      <TopBar />
      <main class="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* 顶层功能切换：识别（图片→英文） / 转换（英文→加密文字） */}
        <div class="flex justify-center">
          <div class="flex rounded-lg border border-[var(--color-surface)] bg-[var(--color-crust)] p-1 text-sm">
            <ModeBtn
              active={mode() === "recognize"}
              onClick={() => $appMode.set("recognize")}
            >
              <ScanText size={14} />
              {t("app.modeRecognize")}
            </ModeBtn>
            <ModeBtn
              active={mode() === "encode"}
              onClick={() => $appMode.set("encode")}
            >
              <Languages size={14} />
              {t("app.modeEncode")}
            </ModeBtn>
          </div>
        </div>

        <Show when={mode() === "recognize"}>
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
              <InputPanel />
            </div>
            <div class="lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
              <ResultPanel />
            </div>
          </div>
          <Show when={showDebug}>
            <DebugPanel />
          </Show>
        </Show>

        <Show when={mode() === "encode"}>
          <EncodePanel />
        </Show>

        <footer class="text-center text-xs text-muted py-4">
          {t("app.footer")}
        </footer>
      </main>
    </div>
  );
}

function ModeBtn(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`flex items-center gap-1.5 px-4 py-1.5 rounded-md transition ${
        props.active
          ? "bg-[var(--color-surface)] text-text glow"
          : "text-muted hover:text-subtext"
      }`}
    >
      {props.children}
    </button>
  );
}
