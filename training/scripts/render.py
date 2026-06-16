"""字体渲染模块：用真字体把字符渲染成统一规格的 64×64 灰度基图。

数据来源(重大更新)：
- 字母 A-Z 用游戏的密文字体 ToStar.ttf (Yh_etnfont60)。
- 数字 0-9 与标点用游戏 fallback 的正常字体 MiSans。
  (游戏里字母被加密成密文字形，数字/标点 fallback 到 MiSans 正常字形。)

关键规格：保尺寸渲染(size-preserving)
    每个字符都按"相对大写字母的真实大小"绘制到固定的 64×64 画布上：
      - 把字体缩放到 大写 H 的字高 = CAP_H 像素；
      - 以 baseline 对齐(anchor="ms"，水平居中、基线固定在 BASELINE_Y)。
    这样标点(句号/逗号)天然就小且贴近基线，不会被放大到铺满画布，
    从而避免"放大的句号"和 NTE 实心圆 'O' 字形撞车。
    分割阶段 extractPatch 会用同样的规格抽取 patch，训练/推理分布一致。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# === 画布与对齐规格 ============================================================
IMG_SIZE = 64
CAP_H = 44          # 大写字母字高(像素)
CAP_TOP = 8         # 大写字母顶部距画布顶端(像素) → baseline = CAP_TOP + CAP_H = 52
BASELINE_Y = CAP_TOP + CAP_H

# === 字符集 ====================================================================
LETTERS: Sequence[str] = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS: Sequence[str] = tuple("0123456789")
# 标点集合(默认常用集，可增删)。注意：这些字符同时作为 类名 和 输出字符。
PUNCT: Sequence[str] = tuple([".", ",", "!", "?", ":", ";", "'", '"', "-", "(", ")", "/"])

REJECT_LABEL = "_"

# 类别表(顺序固定，写入 mapping.json)：字母 → 数字 → 标点 → reject。
CLASSES: Sequence[str] = tuple(list(LETTERS) + list(DIGITS) + list(PUNCT) + [REJECT_LABEL])
REJECT_INDEX = len(CLASSES) - 1

# 每个类别对应的「输出字符串」(reject 输出空串)。
OUTPUT_FOR_CLASS: dict[str, str] = {c: c for c in CLASSES}
OUTPUT_FOR_CLASS[REJECT_LABEL] = ""

# === 字体路径 ==================================================================
_FONTS_DIR = Path(__file__).resolve().parents[1] / "source/nte/fonts"
CIPHER_FONT_PATH = _FONTS_DIR / "ToStar.ttf"               # 密文字母
NORMAL_FONT_PATH = _FONTS_DIR / "MiSansLatin-Demibold.ttf"  # 数字/标点


def font_for_char(ch: str) -> Path:
    """字母走密文字体，其余(数字/标点)走正常字体。"""
    return CIPHER_FONT_PATH if ch.isalpha() else NORMAL_FONT_PATH


@lru_cache(maxsize=8)
def _sized_font(font_path: str) -> ImageFont.FreeTypeFont:
    """加载字体并缩放到 大写 H 字高 == CAP_H。结果按 font_path 缓存。"""
    base = ImageFont.truetype(font_path, 100)
    l, t, r, b = base.getbbox("H")
    cap = max(1, b - t)
    size = max(8, round(100 * CAP_H / cap))
    return ImageFont.truetype(font_path, size)


def render_glyph(ch: str, *, jitter: float = 0.0, rng=None) -> np.ndarray:
    """把单个字符渲染成 IMG_SIZE×IMG_SIZE 的灰度图(白底 255 / 黑字 0)。

    jitter>0 时对基线/水平位置做轻微随机偏移(像素级)，模拟排版差异。
    返回 uint8 ndarray。
    """
    font = _sized_font(str(font_for_char(ch)))
    img = Image.new("L", (IMG_SIZE, IMG_SIZE), 255)
    draw = ImageDraw.Draw(img)

    dx = 0.0
    dy = 0.0
    if jitter > 0 and rng is not None:
        dx = rng.uniform(-jitter, jitter)
        dy = rng.uniform(-jitter, jitter)

    # anchor="ms"：x 为字形水平中点，y 为基线。水平居中 + 基线固定。
    draw.text(
        (IMG_SIZE / 2 + dx, BASELINE_Y + dy),
        ch,
        fill=0,
        font=font,
        anchor="ms",
    )
    return np.array(img, dtype=np.uint8)


@lru_cache(maxsize=1)
def letter_base_images() -> dict[str, np.ndarray]:
    """A-Z 的标准基图(无 jitter)，供 reject 合成器复用。"""
    return {ch: render_glyph(ch) for ch in LETTERS}


def render_class_base(ch: str) -> np.ndarray:
    """非 reject 类的标准基图(无 jitter)，供 templates.bin / sanity 复用。"""
    return render_glyph(ch)


if __name__ == "__main__":
    # 渲染一张全字符预览，便于人工核对字体渲染是否正确。
    import sys

    cols = 13
    cell = IMG_SIZE
    chars = [c for c in CLASSES if c != REJECT_LABEL]
    rows = (len(chars) + cols - 1) // cols
    sheet = np.full((rows * cell, cols * cell), 255, dtype=np.uint8)
    for i, ch in enumerate(chars):
        r, c = divmod(i, cols)
        sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = render_glyph(ch)
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("render_preview.png")
    Image.fromarray(sheet).save(out)
    print(f"classes={len(CLASSES)} (letters={len(LETTERS)} digits={len(DIGITS)} "
          f"punct={len(PUNCT)} +reject), preview -> {out}")
