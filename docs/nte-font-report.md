# Phase 0 — NTE 字体可用性验证报告

**日期**：2026-05-24  
**结论**：用户提供的 `LastResort.ttf` 与 NTE 无关，**NTE 没有可直接使用的原生字体**，项目改走"手工矢量描摹"路线。

## 验证过程

### 1. 文件基础信息

| 项目 | 值 |
| --- | --- |
| 文件名 | `LastResort.ttf` |
| 大小 | 5,395,052 bytes (~5.1 MB) |
| MD5 | `89454f173319872a5fa975b26d028f9d` |
| 文件类型 | TrueType Font, 19 tables, Macintosh |

### 2. Name Table 元信息

```
Family         = 'LastResort'
Subfamily      = 'Regular'
Full name      = 'LastResort'
Version        = '6.0d1e3 (Unicode 5.0.0)'
PostScript     = 'LastResort'
Manufacturer   = 'Apple Inc.'
Designer       = 'Original design by Apple Computer 1998; Block additions by Michael Everson 2001-2003'
Description    = 'The LastResort font is used by the operating system to display Unicode data when no other font can be found. Glyphs correspond to Unicode blocks. The block name and hex range values can be viewed around the border of the glyph at large sizes.'
URL Vendor     = 'http://fonts.apple.com/LastResort/LastResort.html'
```

**判定**：这是 Apple 出品的 **Last Resort Font**，macOS/iOS 自带的 Unicode fallback 字体，目的是在系统找不到任何能渲染某个 Unicode 字符的字体时，提供一个带"块名+码位"信息的占位符。**与 NTE 没有任何关系**。

### 3. cmap 覆盖范围

总计 **388,232 个 Unicode 码位**，覆盖几乎全部 Unicode 平面：

| 区段 | 数量 | 占比 |
| --- | --- | --- |
| SMP (Plane 1) | 65,536 | 16.9% |
| Supplementary Private Use Area-A | 65,536 | 16.9% |
| Supplementary Private Use Area-B | 65,536 | 16.9% |
| CJK Unified Ideographs | 20,924 | 5.4% |
| Hangul Syllables | 11,172 | 2.9% |
| CJK Ext. A | 6,582 | 1.7% |
| Private Use Area | 6,400 | 1.6% |
| ... | ... | ... |

如果是游戏自创文字字体，预期应该只覆盖**少量码位**（通常 26 个英文字母 + 数字 + 标点，最多上百个），且常常位于 PUA 区段（U+E000-U+F8FF）。本字体覆盖范围之广 + Apple 自家字体的身份，进一步坐实了它是 fallback 字体而非游戏专用字体。

## 用户来源推测

用户大概是从以下来源之一误拷的：

- macOS 系统路径 `/System/Library/Fonts/LastResort.ttf`（系统自带）
- NTE 客户端 macOS 包内附带的 fallback 字体（部分游戏会把 Apple 的 LastResort 打包进自己的资源以兜底缺字情况）
- 其他第三方字体合集

## 决策

**否决**字体路线（A 轨），改走**手工矢量描摹**路线（B 轨）：

1. 用户准备清晰的 NTE 自创文字参考截图（PV、宣传图、UP 主实机视频截图均可）
2. 在 Glyphr Studio 中描摹出 26 个英文字母对应的形状
3. 导出 TTF 后，沿用原计划的训练流水线
4. 后续在 GlyphLens 内集成自建描摹器（Phase 7）

## 附：复现命令

```bash
cd /Users/lavac/mine/2026/glyphlens
.venv/bin/python training/scripts/inspect_font.py training/source/nte/LastResort.ttf
```
