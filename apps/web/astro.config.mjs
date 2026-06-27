// @ts-check
import { defineConfig } from "astro/config";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * Vite dev 中间件：把 /ort/* 请求映射到 node_modules/onnxruntime-web/dist/。
 * 避免 .mjs 放 public/ 被 Vite 拦截动态 import。
 */
function ortStaticPlugin() {
  const ortDist = path.resolve("node_modules/onnxruntime-web/dist");
  return {
    name: "ort-static-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/ort/")) return next();
        const urlPath = req.url.split("?")[0];
        const file = path.basename(urlPath);
        const fp = path.join(ortDist, file);
        if (!fs.existsSync(fp)) return next();
        const ext = path.extname(file);
        res.setHeader(
          "Content-Type",
          ext === ".wasm" ? "application/wasm" : "text/javascript",
        );
        fs.createReadStream(fp).pipe(res);
      });
    },
    // 生产构建收尾：把 onnxruntime-web 的 wasm 静态文件放到 dist/ort/，
    // 同时删除 Vite 自动 emit 到 dist/_astro/ 的 onnx wasm（含超大的 jsep 版本，
    // 单文件 25MiB+，会触发 Cloudflare Pages 文件大小限制）。
    // 项目用 executionProviders:["wasm"]，运行时只 fetch /ort/ort-wasm-simd-threaded.wasm，
    // jsep（WebGPU）/ webgl 版本不会被加载，可以安全丢弃。
    apply: "build",
    closeBundle() {
      const ortDist = path.resolve("node_modules/onnxruntime-web/dist");
      const outAstro = path.resolve("./dist/_astro");
      const outOrt = path.resolve("./dist/ort");

      // 1. 复制需要的 wasm 到 dist/ort/（排除 jsep / webgl / jspi 等 GPU 后端）
      fs.mkdirSync(outOrt, { recursive: true });
      for (const f of fs.readdirSync(ortDist)) {
        if (f.endsWith(".wasm") && !/jsep|webgl|jspi/.test(f)) {
          fs.copyFileSync(path.join(ortDist, f), path.join(outOrt, f));
        }
      }

      // 2. 删除 dist/_astro/ 里 Vite emit 的 onnx wasm（避免重复 + 超大文件）
      if (fs.existsSync(outAstro)) {
        for (const f of fs.readdirSync(outAstro)) {
          if (f.endsWith(".wasm") && /ort-wasm|jsep|webgl/.test(f)) {
            fs.unlinkSync(path.join(outAstro, f));
          }
        }
      }
    },
  };
}

export default defineConfig({
  integrations: [solid()],
  vite: {
    worker: { format: "es" },
    plugins: [tailwindcss(), ortStaticPlugin()],
    server: {
      headers: {
        // COEP 注释掉：Vite dev 模式下 WASM 资源没有 CORP 头会被拦截。
        // ONNX Runtime wasm 单线程模式不需要 SharedArrayBuffer。
        // 如果需要多线程，需要给 Vite 资源加 CORP 头或用插件注入。
        // "Cross-Origin-Opener-Policy": "same-origin",
        // "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    optimizeDeps: {
      exclude: ["@techstark/opencv-js"],
    },
  },
});
