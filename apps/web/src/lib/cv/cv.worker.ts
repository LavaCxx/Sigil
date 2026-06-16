/**
 * OpenCV.js Worker (module Worker, fetch + new Function 加载 opencv.js)。
 *
 * 不用 import @techstark/opencv-js（Vite Worker 解析有问题），
 * 不用 importScripts（module Worker 不支持），
 * 改用 fetch 拿到 opencv.js 文本后 new Function() 执行。
 */

import type { PreprocessResult } from "./preprocess";
import type { SegmentResult } from "./segment";
import { preprocess } from "./preprocess";
import { segment } from "./segment";

declare const self: DedicatedWorkerGlobalScope;
declare function fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;

let cv: any = null;
let cvReady = false;

function log(msg: string) {
  self.postMessage({ type: "log", message: msg });
}

function waitForWasm(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof cv.Mat === "function") { cvReady = true; resolve(); return; }
    const t = setTimeout(() => reject(new Error("WASM timeout 120s")), 120_000);
    const p = setInterval(() => {
      if (typeof cv.Mat === "function") { clearTimeout(t); clearInterval(p); cvReady = true; resolve(); }
    }, 50);
    const prev = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => {
      if (typeof prev === "function") prev();
      if (typeof cv.Mat === "function") { clearTimeout(t); clearInterval(p); cvReady = true; resolve(); }
    };
  });
}

async function loadCv(url: string): Promise<void> {
  if (cvReady) return;
  log("fetching " + url);
  const t0 = performance.now();

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("fetch failed: " + resp.status);
  const text = await resp.text();
  log("fetched (" + (performance.now() - t0).toFixed(0) + "ms, " + (text.length / 1e6).toFixed(1) + "MB)");

  // opencv.js 是 UMD，new Function 以 self 为 this 执行，
  // 其中的 `typeof importScripts === 'function'` 分支会设置 self.cv
  const fn = new Function(text);
  fn.call(self);
  cv = (self as any).cv;
  if (!cv) throw new Error("opencv.js executed but self.cv is empty");

  log("script eval'd, waiting WASM...");
  await waitForWasm();
  log("OpenCV ready (total " + (performance.now() - t0).toFixed(0) + "ms)");
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "warmup") {
    try {
      await loadCv(msg.opencvUrl);
      self.postMessage({ type: "ready" });
    } catch (err: any) {
      self.postMessage({ type: "warmup-error", message: err.message || String(err) });
    }
    return;
  }

  if (msg.type === "preprocess-and-segment") {
    const { id, bitmap, segmentConfig, manualSplitXs } = msg;
    try {
      if (!cvReady) throw new Error("OpenCV not ready");
      // 打全 segmentConfig，方便在 DevTools 里肉眼确认调的参数确实到了 worker
      log("preprocessing, segmentConfig=" + (segmentConfig ? JSON.stringify(segmentConfig) : "<default>"));
      const tPre = performance.now();
      const pre = await preprocess(bitmap, cv);
      log("preprocess " + (performance.now() - tPre).toFixed(0) + "ms, " + pre.width + "x" + pre.height);

      const w = pre.width, h = pre.height;
      const wD = (pre.working as any).data as Uint8Array;
      const bD = (pre.binary as any).data as Uint8Array;
      const wBuf = new Uint8Array(w * h);
      const bBuf = new Uint8Array(w * h);
      wBuf.set(new Uint8Array(wD.buffer, wD.byteOffset, w * h));
      bBuf.set(new Uint8Array(bD.buffer, bD.byteOffset, w * h));

      log("segmenting...");
      const tSeg = performance.now();
      const seg = await segment(pre, cv, segmentConfig, manualSplitXs);
      const ds = seg.debugStats;
      log("segment " + (performance.now() - tSeg).toFixed(0) + "ms, " +
        "raw=" + (ds?.rawComponents ?? "?") + " filter→" + (ds?.afterFilter ?? "?") +
        " L1→" + (ds?.afterMergeL1 ?? "?") + " L2→" + (ds?.afterMergeL2 ?? "?") +
        " punct→" + (ds?.afterPunctFilter ?? "?") +
        " glyphs=" + seg.glyphs.length);

      log("extracting patches...");
      const tPatch = performance.now();

      (pre.working as any).delete();
      (pre.binary as any).delete();

      log("patches done in " + (performance.now() - tPatch).toFixed(0) + "ms, posting result...");

      self.postMessage({
        type: "preprocess-and-segment", id,
        pre: { working: wBuf, binary: bBuf, width: w, height: h, scale: pre.scale },
        seg: {
          glyphs: seg.glyphs.map(g => ({
            bbox: g.bbox, bboxOriginal: g.bboxOriginal,
            rowIndex: g.rowIndex, colIndex: g.colIndex,
            spaceBefore: g.spaceBefore, patch: Array.from(g.patch),
          })),
          rejectedCount: seg.rejectedCount,
          debugStats: seg.debugStats,
        },
      });
    } catch (err: any) {
      self.postMessage({ type: "error", id, message: err.message || String(err) });
    } finally {
      bitmap.close();
    }
  }
};
