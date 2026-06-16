# Glyphr Studio 描摹操作指南（NTE 字体）

本指南教你如何用 [Glyphr Studio v2](https://www.glyphrstudio.com/) 把 NTE 游戏内的自创文字描摹成一个真正的 TTF 字体，作为训练数据的源头。

## 0. 准备参考截图

### 截图要求

| 项目 | 要求 |
| --- | --- |
| 来源 | NTE 官方 PV、宣传海报、CBT/技术测试实机、靠谱 UP 主高清视频截帧 |
| 字符清晰度 | 单个字符在截图里至少 80x80 像素以上，能看清笔画拐角和起止 |
| 字符多样性 | 优先收集**字符种类多**的画面（如对话框、招牌、信件全文），而不是一行重复字 |
| 对比度 | 文字与背景反差大的最好（白字黑底 / 黑字白底） |
| 文件位置 | 全部放到 `glyphlens/training/samples/nte/` 下 |

### 数量目标

- **最小启动**：1-3 张能看到 5-10 个不同字符的截图
- **推荐**：5-10 张，能覆盖 26 个字母 + 数字 + 常见标点

### 已知信息（待补充）

游戏内自创文字疑似映射规则、字符总数、是否区分大小写等信息，**请你在截图过程中观察并记录到 `samples/nte/notes.md`**：
- 字符是否区分大小写？
- 数字是单独符号还是复用字母？
- 标点（句号、逗号、问号）有没有出现？
- 字符之间是否有明显的字距和单词间隔？

## 1. 打开 Glyphr Studio

1. 浏览器打开 https://www.glyphrstudio.com/v2/
2. 点击 "**New Glyphr Studio Project**"
3. 项目设置：
   - **Project Name**: `NTE`
   - **Family Name**: `NTE Custom Script`
   - **Designer**: 你的名字（可空）
   - **License**: 留空或选 OFL
   - **Em Square**: `1000`（默认）
   - **Ascent / Descent / Cap Height**: 默认即可，描完后再调

## 2. 导入参考截图作为背景

Glyphr Studio v2 的"参考图层（Guides → Backgrounds）"功能：

1. 左侧 **Glyph edit** 视图，选中你想描的第一个字母槽位（如 `A`）
2. 顶部菜单 **View → Show backgrounds → Add background image**
3. 上传你准备好的 NTE 截图
4. 调整：
   - **Opacity**: 30-50%（半透明，方便描摹时看清自己画的线）
   - **Position/Scale**: 拖动并缩放，让目标字符**对齐到 glyph 编辑框的中心**
   - 如果有 baseline / cap height 参考线，让字符底部对齐 baseline

> 提示：每个字母槽位都是独立的，每个槽位都可以有自己的背景图，所以你可以让每个字母用不同的截图作为参考。

## 3. 用钢笔工具描摹

工具栏左侧选 **Pen tool**（钢笔，快捷键 `P`）。

### 基本操作

| 操作 | 效果 |
| --- | --- |
| 点击 | 添加一个**直角锚点** |
| 拖动 | 添加一个**带切线手柄的曲线锚点**（贝塞尔） |
| Shift + 点击 | 锚点对齐水平/垂直/45°方向 |
| Alt + 拖动手柄 | 让两个手柄不对称（用于尖角处的曲线转折） |
| 双击锚点 | 在直角和曲线之间切换 |
| 闭合路径 | 点击回起始锚点 |

### 描摹策略

1. **先描外轮廓** —— 一笔闭合一个外形，然后再描内部的"洞"（如字母 O 的中空、A 的三角形）
2. **挖洞规则**：Glyphr Studio 用 [非零环绕规则](https://en.wikipedia.org/wiki/Nonzero-rule)，外轮廓顺时针、内洞逆时针即可自动镂空
3. **少用锚点** —— 每段曲线 2-3 个锚点足够，锚点越少越平滑
4. **对称字符**：如 NTE 里如果有对称形状，描一半后选中 → `Edit → Mirror horizontally`，复制粘贴到另一半

### 推荐描摹顺序

先描**笔画区分度大、形态独特**的字母，方便快速验证训练效果：

```
建议先描这 7 个：  A  E  I  O  S  M  N
（元音 + 易区分的辅音，足够测试整条流水线）
```

后续再补全 26 个字母。

## 4. 字母与槽位的映射

Glyphr Studio 默认把每个字符放在对应 Unicode 码位的槽位下。**关键问题：NTE 里的某个 glyph 究竟对应英文哪个字母？**

### 如果你已经知道映射

直接描在对应字母的槽位下即可。比如 NTE 里某个形状你已经确认是 "A"，就在 Glyphr Studio 选中 A 槽位描它。

### 如果你不知道映射

**建议先临时存到 PUA 区段**（U+E000 起），后续靠"猜+对照游戏内英文+自创文字双语场景"来确认对应关系。Glyphr Studio 支持自定义槽位：

1. 顶部 **Glyph navigator** 拖到 Private Use Area
2. 选 U+E000 开始放第一个未知 glyph，依次 U+E001、U+E002...
3. 同时在 `glyphlens/training/source/nte/traced/mapping-notes.md` 里手动记录：
   ```
   U+E000 -> ??? (来自截图 dialog_01.png 第 2 个字符)
   U+E001 -> ??? (来自截图 sign_03.png 第 5 个字符)
   ```
4. 找到双语对照画面后再补齐对应关系

> 这一步可以等到全部描完后再统一做"破译"，所以不要被它阻塞描摹进度。

## 5. 导出

1. 顶部菜单 **Export → Export Glyphr Studio Project File**
   - 保存为 `nte.glyphrproject`
   - 放到 `glyphlens/training/source/nte/traced/`
2. 顶部菜单 **Export → Export OTF / TTF File**
   - 选 TTF
   - 保存为 `nte.ttf`
   - 放到 `glyphlens/training/source/nte/traced/`

## 6. 自查清单

- [ ] 至少描了 5 个字母
- [ ] 每个字母的轮廓闭合（没有"开口"的路径）
- [ ] 锚点数量合理（不会一个字母用 50 个锚点）
- [ ] 导出的 TTF 在系统字体预览里能正确显示（macOS：双击 TTF → 安装 → 在字体册里查看）
- [ ] `.glyphrproject` 项目文件也一并保存了（便于后续修改）
- [ ] 在 `samples/nte/notes.md` 里记录了字符观察结论

## 7. 下一步

告诉 agent "**TTF 描好了**"，我会：

1. 运行 `inspect_font.py` 验证导出的 TTF 结构正确
2. 把每个 glyph 渲染成总览图（确认描摹结果符合预期）
3. 启动 Phase 1 训练流水线，用这 5-10 个字母先跑通"渲染 → 增强 → 训练 → 推理"的最小闭环
4. 给你一份初步识别效果报告，决定下一步是补全字母、调整描摹、还是改进训练参数

---

## 附：替代方案

如果你觉得 Glyphr Studio 的钢笔工具不顺手，也可以：

- **Inkscape**（桌面，免费）：导入参考图 → 钢笔工具描 → 每个字母导出为 SVG → 用 FontForge 合成 TTF
- **Figma / Affinity Designer**：UI 更顺手，但导出到字体需要中转
- **BirdFont**（桌面，部分免费）：和 Glyphr Studio 类似的字体编辑器

但前期建议直接用 Glyphr Studio，因为它一站式完成"描摹 → 导出 TTF"，零中转步骤。
