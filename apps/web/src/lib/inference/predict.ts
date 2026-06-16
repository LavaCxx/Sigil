/**
 * 批量推理：把 N 个 64×64 patch → (N, 27) 概率，输出 top-K 字母与置信度。
 *
 * 归一化协议来自 mapping.json model_input.normalization：
 *   (pixel / 255 - 0.5) / 0.5  等价于 (pixel - 127.5) / 127.5
 *
 * 训练时模型见过 50% 反色增强，所以白底黑字 / 黑底白字都行；这里输入沿用
 * segment 给出的「白底黑字 (255=背景, 0=前景)」与训练分布一致。
 */

import * as ort from "onnxruntime-web";
import type { LoadedPack } from "~/types/pack";
import { getInferenceSession } from "./session";

export interface PatchPrediction {
  /** 该 patch 的最高分字母（reject 类被映射为空串 ""，UI 渲染为 mapping.reject_class.render 或 "?"） */
  letter: string;
  /** softmax 后置信度 (0-1) */
  confidence: number;
  /** top-3 备选 */
  alternatives: Array<{ letter: string; confidence: number }>;
  /** 是否落到了 reject 类（argmax === reject_class.index） */
  isReject: boolean;
  /** 置信度低于 mapping.confidence_threshold 时为 true，前端可在 UI 上标 ? */
  belowThreshold: boolean;
}

const MODEL_INPUT_SIZE = 64;
const TOP_K = 3;

export async function predictBatch(
  patches: Uint8ClampedArray[],
  pack: LoadedPack
): Promise<PatchPrediction[]> {
  if (patches.length === 0) return [];

  const modelUrl = `${pack.baseUrl}/${pack.meta.files.model}`;
  const session = await getInferenceSession(pack.meta.id, modelUrl);

  const labels = pack.mapping.output_index_to_letter;
  const numClasses = labels.length;
  const rejectIndex = pack.mapping.reject_class?.index ?? -1;
  const threshold = pack.mapping.confidence_threshold ?? 0;

  const N = patches.length;
  const sz = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const buffer = new Float32Array(N * sz);
  for (let i = 0; i < N; i++) {
    const src = patches[i]!;
    const dstOffset = i * sz;
    for (let j = 0; j < sz; j++) {
      buffer[dstOffset + j] = src[j]! / 127.5 - 1;
    }
  }

  const inputName = pack.mapping.model_input.name;
  const outputName = pack.mapping.model_output.name;

  const tensor = new ort.Tensor("float32", buffer, [N, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };

  const results = await session.run(feeds);
  const logits = results[outputName];
  if (!logits) {
    throw new Error(`ONNX 输出里找不到 "${outputName}"，实际有：${Object.keys(results).join(", ")}`);
  }
  const data = logits.data as Float32Array;

  const out: PatchPrediction[] = [];
  for (let i = 0; i < N; i++) {
    const row = data.subarray(i * numClasses, (i + 1) * numClasses);
    const probs = softmax(row);
    const sorted = topKIndices(probs, Math.min(numClasses, TOP_K + 4));
    const finalIdx = sorted[0]!;
    const conf = probs[finalIdx] ?? 0;
    const isReject = finalIdx === rejectIndex;
    const altIdx = sorted.filter((idx) => idx !== finalIdx).slice(0, TOP_K - 1);
    out.push({
      letter: labels[finalIdx] ?? "?",
      confidence: conf,
      alternatives: altIdx.map((idx) => ({
        letter: labels[idx] ?? "?",
        confidence: probs[idx] ?? 0,
      })),
      isReject,
      belowThreshold: !isReject && conf < threshold,
    });
  }
  return out;
}

function softmax(logits: Float32Array): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i]! > max) max = logits[i]!;
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i]! - max);
    exps[i] = e;
    sum += e;
  }
  for (let i = 0; i < logits.length; i++) exps[i] = exps[i]! / sum;
  return exps;
}

function topKIndices(arr: Float32Array, k: number): number[] {
  const idx = Array.from({ length: arr.length }, (_, i) => i);
  idx.sort((a, b) => arr[b]! - arr[a]!);
  return idx.slice(0, k);
}
