# Glyphr Studio 描摹产出投放区

把你在 Glyphr Studio 里描摹 NTE 自创文字的产出文件放在这里。

## 期望的文件

| 文件 | 必需 | 说明 |
| --- | --- | --- |
| `nte.glyphrproject` | 推荐 | Glyphr Studio 原生项目文件（JSON），保留所有矢量信息便于后续修改 |
| `nte.ttf` | 必需 | 从 Glyphr Studio 导出的 TTF，训练流水线的实际输入 |
| `nte.otf` | 可选 | 如果你也导出了 OTF |

## 使用流程

1. 打开 [Glyphr Studio v2](https://www.glyphrstudio.com/)（建议用 Chrome / Edge）
2. 按 [`docs/glyphr-tracing-guide.md`](../../../../docs/glyphr-tracing-guide.md) 的步骤操作
3. 描完后导出 TTF + Glyphr Project，都丢到这个目录
4. 通知 agent 启动 Phase 1 训练流水线联调

## 命名约定

- 第一版：`nte.ttf` / `nte.glyphrproject`
- 后续迭代：`nte-v2.ttf`、`nte-bold.ttf` 等（如果发现游戏内有不同字重）

## 注意

- **不要**把参考截图放在这里，它们应该放到 `../../../samples/nte/`
- **不要**把已确认无关的 `LastResort.ttf` 放进来
