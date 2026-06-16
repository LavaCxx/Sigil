import { Show, onMount } from "solid-js";
import { useStore } from "@nanostores/solid";
import { ScanText, Languages } from "lucide-solid";
import { bootstrapPacks } from "~/stores/pack";
import { $appMode, type AppMode } from "~/stores/mode";
import { warmupPipeline } from "~/lib/pipeline";
import TopBar from "./TopBar";
import InputPanel from "./InputPanel";
import ResultPanel from "./ResultPanel";
import DebugPanel from "./DebugPanel";
import EncodePanel from "./EncodePanel";

export default function App() {
  const mode = useStore($appMode);

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
              识别 · 加密文字 → 英文
            </ModeBtn>
            <ModeBtn
              active={mode() === "encode"}
              onClick={() => $appMode.set("encode")}
            >
              <Languages size={14} />
              转换 · 英文 → 加密文字
            </ModeBtn>
          </div>
        </div>

        <Show when={mode() === "recognize"}>
          <div class="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div class="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
              <InputPanel />
            </div>
            <div class="lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
              <ResultPanel />
            </div>
          </div>
          <DebugPanel />
        </Show>

        <Show when={mode() === "encode"}>
          <EncodePanel />
        </Show>

        <footer class="text-center text-xs text-muted py-4">
          GlyphLens · 浏览器内推理 · 图像不离开本机
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
