# Sigil

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 把游戏里那些看不懂的符号，变成你看得懂的中文。

Sigil 是一个浏览器内运行的游戏自创文字识别与翻译工具。把游戏截图丢进去，那些看不懂的符号会被还原成英文，再自动翻译成中文——所有图像处理与神经网络推理都在你的浏览器里完成，截图不离开本机。

首发支持：**异环（Neverness to Everness）**。

## 特性

- **完全本地**：图像处理与神经网络推理都在浏览器里跑，截图不上传任何服务器
- **多源输入**：上传 / 粘贴 / 拖拽 / 屏幕捕获 / 拍照
- **自动翻译**：识别出英文后自动翻译成中文，逐句对照
- **双向**：除了识别，也能反向把英文渲染成游戏里的密文字体（编码模式）
- **中英界面**：UI 语言可切换，URL `?lang=en` 直链分享
- **可插拔字体包**：一个目录 = 一款游戏，新增游戏不动核心代码

## 快速开始

**在线使用**：（部署后在此填入链接）

**本地运行：**

```bash
pnpm install
pnpm dev    # http://localhost:4321/
```

## 技术栈

Astro · SolidJS · Tailwind CSS v4 · OpenCV.js · ONNX Runtime Web · Python / PyTorch（离线训练）

## 贡献

欢迎 issue 和 PR。如果想为新游戏制作字体包，请先开个 issue 讨论数据来源与字体授权。

## License

[MIT](LICENSE)
