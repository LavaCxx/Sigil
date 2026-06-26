/**
 * OpenCV.js 加载器（主线程接口）。
 *
 * OpenCV 在 classic Web Worker 里通过 importScripts() 加载，
 * 主线程保持响应。preprocess + segment 也在 Worker 里完成。
 */

let worker: Worker | null = null;
let cvReady = false;
let nextMsgId = 1;

interface PendingReq {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, PendingReq>();

const OPENCV_URL = new URL("/opencv/opencv.js", location.origin).href;

function ensureWorker(): Worker {
  if (worker) return worker;

  // module Worker + fetch 加载 opencv（不用 import，不用 importScripts）
  worker = new Worker(
    new URL("./cv.worker.ts", import.meta.url),
    { type: "module", name: "sigil-cv" },
  );

  worker.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "ready") {
      cvReady = true;
      console.info("[cv] Worker ready");
      return;
    }
    if (msg.type === "warmup-error") {
      console.error("[cv] warmup failed:", msg.message);
      return;
    }
    if (msg.type === "log") {
      console.info("[cv]", msg.message);
      return;
    }
    const h = pending.get(msg.id);
    if (!h) return;
    pending.delete(msg.id);
    if (msg.type === "error") h.reject(new Error(msg.message));
    else h.resolve(msg);
  });

  worker.addEventListener("error", (e) => {
    console.error("[cv] Worker error:", e.message);
    for (const [, h] of pending) h.reject(new Error("Worker crashed: " + e.message));
    pending.clear();
    worker = null;
    cvReady = false;
  });

  // 触发预热
  worker.postMessage({ type: "warmup", opencvUrl: OPENCV_URL });
  return worker;
}

const TIMEOUT = 120_000;

function send<T>(msg: any, transfer?: Transferable[]): Promise<T> {
  const w = ensureWorker();
  const id = nextMsgId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Worker timeout (" + TIMEOUT / 1000 + "s)"));
    }, TIMEOUT);
    pending.set(id, {
      resolve: (v: any) => { clearTimeout(timer); resolve(v); },
      reject: (e: Error) => { clearTimeout(timer); reject(e); },
    });
    if (transfer) w.postMessage({ ...msg, id }, transfer);
    else w.postMessage({ ...msg, id });
  });
}

export function warmupPipeline() { ensureWorker(); }
export function isCvReady() { return cvReady; }

/**
 * Worker 调用串行化：即便有多次并发调用，也按 FIFO 一个一个跑。
 * Worker 自己的 onmessage 是 async 的，多次并发请求会在 WASM heap 上交错分配
 * 并争用 cv 模块，曾经表现为「卡在某一步」。
 */
let workerQueueTail: Promise<unknown> = Promise.resolve();

export async function preprocessAndSegment(
  bitmap: ImageBitmap,
  segmentConfig?: Partial<import("./segment").SegmentConfig>,
  manualSplitXs?: number[],
) {
  const clone = await createImageBitmap(bitmap);
  // 在队尾排队：等之前所有任务跑完再执行自己
  const prev = workerQueueTail;
  let release!: () => void;
  workerQueueTail = new Promise<void>((r) => { release = r; });
  try {
    await prev;
    return await send<{
      pre: { working: Uint8Array; binary: Uint8Array; width: number; height: number; scale: number };
      seg: import("./segment").SegmentResult;
    }>({ type: "preprocess-and-segment", bitmap: clone, segmentConfig, manualSplitXs }, [clone]);
  } finally {
    release();
  }
}

/** compat */
export async function getCv(): Promise<any> { return null; }
