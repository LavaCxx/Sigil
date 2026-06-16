/**
 * ONNX Runtime Web 会话管理。
 *
 * Vite 预打包 onnxruntime-web 的 JS，但 WASM 二进制文件
 * 需要从 public/ort/ 静态提供（Vite 不处理 .wasm 依赖）。
 */

import * as ort from "onnxruntime-web";

let envConfigured = false;
function configureOrtEnv() {
  if (envConfigured) return;
  envConfigured = true;

  if (typeof navigator !== "undefined") {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/ort/";
  }
  ort.env.logLevel = "error";
}

interface CachedSession {
  packId: string;
  modelUrl: string;
  session: ort.InferenceSession;
}

let cache: CachedSession | null = null;
let inflight: Promise<ort.InferenceSession> | null = null;

export async function getInferenceSession(
  packId: string,
  modelUrl: string
): Promise<ort.InferenceSession> {
  configureOrtEnv();

  if (cache && cache.packId === packId && cache.modelUrl === modelUrl) {
    return cache.session;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    cache = { packId, modelUrl, session };
    return session;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function isSessionReady(packId: string): boolean {
  return cache?.packId === packId;
}
