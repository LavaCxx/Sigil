"""把 26 个二值化 glyph PNG 矢量化为 TTF 字体文件。

流程:
1. cv2.findContours 提取每个字母的多边形轮廓（含洞）
2. cv2.approxPolyDP 简化顶点
3. 归一化到 1000 em 坐标系（TTF 标准）
4. 通过 fontTools.fontBuilder 构建 TTF

注意: 输出是纯多边形字体（没有贝塞尔曲线），对于这些以直线/直角为主的 NTE
glyph 视觉效果完全 OK；如果未来想要更光滑的曲线，可换成 potrace。

用法:
    python vectorize_to_ttf.py
输出:
    training/source/nte/traced/nte.ttf
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "training/source/nte/glyphs/binary"
OUT_PATH = ROOT / "training/source/nte/traced/nte.ttf"

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

UNITS_PER_EM = 1000
ASCENT = 800
DESCENT = -200
GLYPH_MARGIN = 40
APPROX_EPS_FRAC = 0.005


def trace_glyph(img_path: Path) -> list[list[tuple[int, int]]]:
    """从二值 PNG 中提取多边形轮廓，归一化到 em 坐标系。"""
    img = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise RuntimeError(f"Failed to read {img_path}")

    binary = 255 - img
    _, binary = cv2.threshold(binary, 128, 255, cv2.THRESH_BINARY)

    contours, hierarchy = cv2.findContours(
        binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return []

    coords_concat = np.concatenate([c.reshape(-1, 2) for c in contours], axis=0)
    min_x, min_y = coords_concat.min(axis=0)
    max_x, max_y = coords_concat.max(axis=0)
    width = max_x - min_x
    height = max_y - min_y
    scale_x = (UNITS_PER_EM - 2 * GLYPH_MARGIN) / max(width, 1)
    scale_y = (ASCENT - DESCENT - 2 * GLYPH_MARGIN) / max(height, 1)
    scale = min(scale_x, scale_y)

    final_width = width * scale
    offset_x = (UNITS_PER_EM - final_width) / 2

    polygons: list[list[tuple[int, int]]] = []
    for idx, contour in enumerate(contours):
        epsilon = APPROX_EPS_FRAC * cv2.arcLength(contour, closed=True)
        approx = cv2.approxPolyDP(contour, epsilon, closed=True)
        pts = approx.reshape(-1, 2).astype(np.float64)
        if len(pts) < 3:
            continue
        pts[:, 0] = (pts[:, 0] - min_x) * scale + offset_x
        pts[:, 1] = ASCENT - GLYPH_MARGIN - (pts[:, 1] - min_y) * scale

        # Y 轴翻转后所有轮廓方向都反了，统一翻转以满足 TrueType 要求
        # (外轮廓→逆时针，内轮廓/洞→顺时针)
        pts = pts[::-1]
        polygons.append([(int(round(x)), int(round(y))) for x, y in pts])

    return polygons


def build_glyph(polygons: list[list[tuple[int, int]]]):
    pen = TTGlyphPen(None)
    for poly in polygons:
        if not poly:
            continue
        pen.moveTo(poly[0])
        for pt in poly[1:]:
            pen.lineTo(pt)
        pen.closePath()
    return pen.glyph()


def build_blank_glyph():
    pen = TTGlyphPen(None)
    return pen.glyph()


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    glyph_order = [".notdef", "space"]
    for letter in LETTERS:
        glyph_order.append(letter)
        glyph_order.append(letter.lower())

    cmap = {ord(" "): "space"}
    for letter in LETTERS:
        cmap[ord(letter)] = letter
        cmap[ord(letter.lower())] = letter

    glyphs = {".notdef": build_blank_glyph(), "space": build_blank_glyph()}
    advance_widths = {".notdef": 600, "space": 300}

    for letter in LETTERS:
        polygons = trace_glyph(SOURCE_DIR / f"{letter}.png")
        glyph = build_glyph(polygons)
        glyphs[letter] = glyph
        glyphs[letter.lower()] = build_glyph(polygons)
        advance_widths[letter] = UNITS_PER_EM
        advance_widths[letter.lower()] = UNITS_PER_EM
        print(f"  {letter}: {sum(len(p) for p in polygons)} verts across {len(polygons)} contours")

    fb = FontBuilder(unitsPerEm=UNITS_PER_EM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (advance_widths[name], 0) for name in glyph_order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable(
        {
            "familyName": "NTE Custom Script",
            "styleName": "Regular",
            "fullName": "NTE Custom Script Regular",
            "psName": "NTECustomScript-Regular",
            "version": "Version 1.0",
            "manufacturer": "GlyphLens (auto-vectorized from reference chart)",
        }
    )
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT)
    fb.setupPost()

    fb.save(OUT_PATH)
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"\nTTF saved to {OUT_PATH} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
