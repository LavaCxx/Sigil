# Sigil

一个浏览器内运行的「游戏自创文字」识别与翻译工具，采用可插拔字体包支持多游戏。首发实现：异环（NTE / Neverness to Everness）。

识别游戏内自创符号文字 → 还原成英文 → 自动翻译成中文；也支持反向把英文渲染成加密文字。所有图像处理与神经网络推理都在浏览器内完成，图像不离开本机。

> 协作上下文与开发约定见 [`CLAUDE.md`](CLAUDE.md)。

## 功能

- **识别**：截图 / 上传 / 粘贴 / 屏幕捕获 → 加密文字 → 英文 + 中文翻译
- **加密文字渲染**：英文 → 字体包对应的密文字体图片，可下载
- **多语言 UI**：中英文切换，记忆偏好
- **可插拔字体包**：新增游戏 = 新增 `packs/<id>/` 目录 + 注册表条目，不动核心代码
- **ROI 裁剪**：整屏截图里框出文字区域，提升识别准确率
- **隐私**：图像处理与推理全在浏览器，不联网上传图像（翻译用 MyMemory API）

## 当前进度

| 阶段 | 状态 |
|------|------|
| Phase 0–4：字体验证 / 训练流水线 / Web 骨架 / OpenCV 分割 / ONNX 推理 | 完成 |
| 中英 UI 切换、Encode 模式、中文翻译 | 完成 |
| Phase 5：真实游戏截图端到端评测 | 进行中 |

NTE 字体包 v0.5.2：49 类（A–Z + 0–9 + 12 标点 + reject），`model.onnx` ~406 KB，训练数据来自游戏真字体 `ToStar.ttf` + `MiSans`。

## 启动开发

```bash
cd glyphlens
pnpm install        # 首次
pnpm dev            # http://localhost:4321/
```

类型检查：`cd apps/web && pnpm exec astro check`
构建：`pnpm build`

## 目录结构

```
glyphlens/
├── CLAUDE.md                # 协作指南（架构 / 规范 / 坑点）
├── README.md
├── package.json             # pnpm workspace 根
├── pnpm-workspace.yaml
├── .venv/                   # Python 训练环境（gitignore）
├── packs/
│   └── nte/                 # 生产字体包（前端 fetch）
│       ├── meta.json / mapping.json
│       ├── model.onnx / font.ttf / preview.png / templates.bin
├── training/
│   ├── scripts/             # 训练 / 导出 / 打包脚本
│   ├── checkpoints/nte/     # 权重、混淆矩阵、sanity
│   ├── source/nte/          # 原始数据、对照表、提取 glyph
│   └── samples/nte/         # 真实游戏截图（Phase 5 评测用）
└── apps/web/                # Astro + SolidJS Web 应用
    ├── astro.config.mjs
    ├── public/
    │   ├── opencv/opencv.js # OpenCV WASM（Worker 加载）
    │   ├── ort/             # ONNX Runtime WASM
    │   └── packs -> ../../../packs
    └── src/
        ├── pages/index.astro
        ├── layouts/Base.astro
        ├── components/      # App, TopBar, InputPanel, ResultPanel, EncodePanel, GameSelector
        ├── lib/
        │   ├── pipeline.ts  # ★ 识别流水线
        │   ├── translate.ts # MyMemory 翻译
        │   ├── cv/          # loader, preprocess, segment, debug, inpaint, cv.worker
        │   ├── inference/   # session, predict, template-match
        │   └── packs/       # loader, font
        ├── stores/          # pack, input, result, mode, encode, locale, segmentConfig, manualSplits
        ├── types/pack.ts    # ★ 强类型契约
        └── styles/global.css
```

## 识别流水线

```
用户图像
    ↓
[可选 ROI 裁剪]
    ↓
preprocess（OpenCV Worker：灰度 + 对比度归一化）
    ↓
segment（水平/垂直投影法字符分割）
    ↓
classify（ONNX TinyGlyphCNN，失败兜底 NCC 模板匹配）
    ↓
postprocess（多行 / 空格 / reject 过滤）
    ↓
RecognitionResult → UI + 自动中文翻译
```

## 调试面板

识别模式下的参数调节 / patch 可视化面板默认对生产用户隐藏，开发时通过以下任一方式打开：

- 开发模式（`pnpm dev`）自动显示
- 生产构建访问时 URL 加 `?debug=1`

## 技术栈

| 层 | 技术 |
|----|------|
| Web 前端 | Astro 5 + SolidJS + Tailwind CSS v4 + nanostores |
| 图像处理 | OpenCV.js 4.12（WASM，Web Worker） |
| 推理 | onnxruntime-web 1.23（WASM 单线程） |
| 离线训练 | Python + PyTorch + Pillow + fontTools + albumentations |
| 包管理 | pnpm workspace |
| 翻译 | MyMemory API |

## 添加新游戏字体包

1. 准备游戏真字体文件（TTF/OTF）或描摹数据
2. 用 `training/scripts/` 的流水线训练、导出 ONNX、打包
3. 把产出放进 `packs/<id>/`
4. 在 `apps/web/src/stores/pack.ts` 的 `$registry` 数组里加条目

## 开放问题

- Phase 5 评测：需要真实游戏截图 + ground truth，量化端到端准确率
- reject 类召回率偏低（~7%）
- 离线翻译：当前 MyMemory 需联网
- 部署：Cloudflare Pages / Vercel 尚未配置
