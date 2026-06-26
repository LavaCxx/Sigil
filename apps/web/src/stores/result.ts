/**
 * 识别结果状态与触发流程。
 *
 * 并发保护：runRecognition 用「正在跑就直接忽略」策略而不是排队，
 * 避免连点 N 次后造成主线程 + worker + 推理 session 多倍负载（这就是用户
 * 之前看到的「卡在拼装结果」的根因）。再加一个 runId 兜底，防止 stage
 * 状态被旧任务的回调覆盖。
 */

import { atom, task } from "nanostores";
import type { RecognitionResult } from "~/types/pack";
import type { TranslationResult } from "~/lib/translate";
import { $currentInput, $roi } from "./input";
import { $loadedPack } from "./pack";
import { $segmentConfig } from "./segmentConfig";
import { $manualSplitXs } from "./manualSplits";
import { recognize, type PipelineStage } from "~/lib/pipeline";
import { translateText } from "~/lib/translate";
import { t } from "./locale";

export const $result = atom<RecognitionResult | null>(null);
export const $recognizing = atom<boolean>(false);
export const $recognizeError = atom<string | null>(null);
export const $recognitionStage = atom<PipelineStage | null>(null);

/** 中文翻译相关状态 */
export const $translation = atom<TranslationResult | null>(null);
export const $translating = atom<boolean>(false);
export const $translateError = atom<string | null>(null);

let currentRunId = 0;
const log = typeof console !== "undefined" ? console.log.bind(console, "[recognize]") : () => {};

export function runRecognition(): void {
  if ($recognizing.get()) {
    log("忽略：上一轮还在跑");
    return;
  }
  const input = $currentInput.get();
  const pack = $loadedPack.get();
  if (!input || !pack) {
    $recognizeError.set(input ? t("error.packNotLoaded") : t("error.noImage"));
    return;
  }

  const runId = ++currentRunId;
  $recognizing.set(true);
  $recognizeError.set(null);
  $recognitionStage.set("loading-cv");
  $translation.set(null);
  $translateError.set(null);

  task(async () => {
    try {
      const result = await recognize(input, pack, {
        onProgress: (stage) => {
          if (runId !== currentRunId) return;
          $recognitionStage.set(stage);
        },
        onDebugReady: (debug) => {
          if (runId !== currentRunId) return;
          const r = $result.get();
          if (!r) return;
          $result.set({ ...r, debug: { ...r.debug, ...debug } });
        },
      }, $segmentConfig.get(), $roi.get(), $manualSplitXs.get());
      if (runId !== currentRunId) {
        log("丢弃旧 run 的结果", runId);
        return;
      }
      $result.set(result);

      // 识别成功后自动触发中文翻译
      if (result.text.trim().length > 0) {
        void runTranslation(result.text, runId);
      }
    } catch (err) {
      if (runId !== currentRunId) return;
      const message = err instanceof Error ? err.message : String(err);
      $recognizeError.set(message);
    } finally {
      if (runId === currentRunId) {
        $recognizing.set(false);
        $recognitionStage.set(null);
      }
    }
  });
}

async function runTranslation(englishText: string, runId: number): Promise<void> {
  $translating.set(true);
  $translateError.set(null);
  try {
    const result = await translateText(englishText);
    if (runId !== currentRunId) return;
    $translation.set(result);
  } catch (err) {
    if (runId !== currentRunId) return;
    const message = err instanceof Error ? err.message : String(err);
    $translateError.set(message);
    log("翻译失败:", message);
  } finally {
    if (runId === currentRunId) {
      $translating.set(false);
    }
  }
}

export function clearResult(): void {
  $result.set(null);
  $recognizeError.set(null);
  $translation.set(null);
  $translateError.set(null);
}
