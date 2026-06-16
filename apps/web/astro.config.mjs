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
