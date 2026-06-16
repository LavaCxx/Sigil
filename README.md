# GlyphLens

一个浏览器内运行的"游戏自创文字"识别翻译工具，采用可插拔的字体包插件机制支持多游戏。首发参考实现：异环（NTE / Neverless to Everless）。

> **新对话/接手者请先读 [`docs/HANDOFF.md`](docs/HANDOFF.md)** —— 包含恢复全部上下文所需的信息：项目目标、阶段进度、关键决策、已知坑点、Phase 3-4 实施指引。

详细规划见 [`.cursor/plans/glyphlens_多游戏文字识别_*.plan.md`](../../.cursor/plans/)。

## 当前进度：Phase 0 / 0a / 1 / 2 全部完成 ✓

- **字体包已产出**（41KB，验证准确率 99.23%）→ 详见 [`docs/phase1-training-report.md`](docs/phase1-training-report.md)
- **Web App 骨架已搭好**（Astro + SolidJS + Tailwind + Nano Stores），CV/推理流水线占位实现，UI 全链路跑通。`pnpm dev` 即可启动 http://localhost:4321/

```
glyphlens/
├── README.md
├── package.json                           # pnpm workspace 根
├── pnpm-workspace.yaml
├── .venv/                                 # Python 虚拟环境（训练侧）
├── docs/
│   ├── nte-font-report.md                 # Phase 0 字体验证报告
│   ├── glyphr-tracing-guide.md            # Glyphr Studio 描摹操作指南（备用）
│   └── phase1-training-report.md          # Phase 1 训练流水线报告
├── packs/
│   └── nte/                               # 首个生产字体包（41KB）
│       ├── meta.json / mapping.json
│       ├── model.onnx (20.5 KB)
│       ├── font.ttf (6 KB)
│       └── preview.png
├── training/                              # 离线训练（Python）
│   ├── scripts/                           # 全套训练流水线脚本
│   ├── checkpoints/nte/                   # 权重、混淆矩阵、ONNX、sanity
│   └── source/nte/                        # 原始数据 + glyph 提取
└── apps/
    └── web/                               # >> Web App（Astro + SolidJS）<<
        ├── astro.config.mjs
        ├── tsconfig.json
        ├── src/
        │   ├── pages/index.astro
        │   ├── layouts/Base.astro
        │   ├── components/                # TopBar, GameSelector, InputPanel, ResultPanel, DebugPanel, App
        │   ├── lib/
        │   │   ├── packs/loader.ts        # 字体包动态加载
        │   │   └── pipeline.ts            # CV+推理流水线（Phase 2 占位 / Phase 3-4 真实现）
        │   ├── stores/                    # nanostores: pack/input/result
        │   ├── types/pack.ts
        │   └── styles/global.css          # Tailwind v4 + Catppuccin Mocha
        └── public/packs -> ../../../packs # 软链让前端能 fetch
```

## 启动开发

```bash
cd glyphlens
pnpm dev         # 启动 http://localhost:4321/
```

## 下一步：Phase 3-4 — 真实 CV 与推理

[`apps/web/src/lib/pipeline.ts`](apps/web/src/lib/pipeline.ts) 当前是占位实现，下一步要：

1. **Phase 3**：集成 OpenCV.js，实现真实的字符分割（MSER / 自适应阈值 + 连通域）
2. **Phase 4**：集成 ONNX Runtime Web，加载 [`packs/nte/model.onnx`](packs/nte/model.onnx) 跑真实推理
3. **Phase 5**：用真实 NTE 游戏截图评测端到端准确率

## 技术栈（计划中）

| 层 | 技术 |
| --- | --- |
| Web 前端 | Astro + SolidJS + Tailwind + Nano Stores |
| 图像处理 | OpenCV.js (WASM) |
| 推理 | ONNX Runtime Web (WebGPU / WASM SIMD) |
| 离线训练 | Python + PyTorch + Pillow + fontTools + albumentations |
| 部署 | Cloudflare Pages / Vercel（纯静态） |
