"""从对照表图片中切出每个 NTE glyph。

输入：training/source/nte/reference_chart.png（7 列 × 8 行的网格图）
布局：行 1/3/5/7 是英文参考，行 2/4/6/8 是 NTE 自创文字
输出：
- training/source/nte/glyphs/raw/<letter>.png      每个字母原始裁剪
- training/source/nte/glyphs/binary/<letter>.png   二值化 + 紧致裁剪
- training/source/nte/glyphs/preview.png           总览拼图（便于人工核对）

用法:
    python extract_glyphs.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CHART_PATH = ROOT / "training/source/nte/reference_chart.png"
OUT_ROOT = ROOT / "training/source/nte/glyphs"
RAW_DIR = OUT_ROOT / "raw"
BIN_DIR = OUT_ROOT / "binary"
PREVIEW_PATH = OUT_ROOT / "preview.png"

COLS = 7
ROWS = 8

GLYPH_ROW_LETTERS = {
    1: "ABCDEFG",
    3: "HIJKLMN",
    5: "OPQRST",
    7: "UVWXYZ",
}

INSET_RATIO = 0.06
PADDING = 8
BINARIZE_THRESHOLD = 200


def crop_cell(image: Image.Image, row: int, col: int) -> Image.Image:
    """按等分网格裁剪一个格子，向内收缩 INSET_RATIO 以去除黑色网格线。"""
    width, height = image.size
    cell_w = width / COLS
    cell_h = height / ROWS

    left = int(col * cell_w + cell_w * INSET_RATIO)
    upper = int(row * cell_h + cell_h * INSET_RATIO)
    right = int((col + 1) * cell_w - cell_w * INSET_RATIO)
    lower = int((row + 1) * cell_h - cell_h * INSET_RATIO)

    return image.crop((left, upper, right, lower))


def binarize_and_trim(cell: Image.Image) -> Image.Image:
    """转为黑白二值图并紧致裁剪到字符外接框 + 固定 padding。"""
    gray = cell.convert("L")
    arr = np.array(gray)

    mask = arr < BINARIZE_THRESHOLD
    if not mask.any():
        return Image.new("L", (64, 64), 255)

    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]

    binary_arr = np.where(mask, 0, 255).astype(np.uint8)
    cropped = binary_arr[top : bottom + 1, left : right + 1]

    padded = np.full(
        (cropped.shape[0] + 2 * PADDING, cropped.shape[1] + 2 * PADDING),
        255,
        dtype=np.uint8,
    )
    padded[PADDING : PADDING + cropped.shape[0], PADDING : PADDING + cropped.shape[1]] = cropped

    return Image.fromarray(padded, mode="L")


def build_preview(glyphs: dict[str, Image.Image]) -> Image.Image:
    """生成 5 列 × ceil(26/5)=6 行的总览拼图，便于人工核对。"""
    cell_size = 120
    label_height = 24
    cols = 5
    rows = (len(glyphs) + cols - 1) // cols

    canvas = Image.new("RGB", (cols * cell_size, rows * (cell_size + label_height)), "white")
    draw = ImageDraw.Draw(canvas)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 18)
    except OSError:
        font = ImageFont.load_default()

    for idx, (letter, glyph) in enumerate(sorted(glyphs.items())):
        r, c = divmod(idx, cols)
        x = c * cell_size
        y = r * (cell_size + label_height)

        resized = glyph.copy()
        resized.thumbnail((cell_size - 8, cell_size - 8), Image.LANCZOS)
        gx = x + (cell_size - resized.size[0]) // 2
        gy = y + (cell_size - resized.size[1]) // 2
        canvas.paste(resized.convert("RGB"), (gx, gy))

        draw.text((x + 4, y + cell_size + 2), letter, fill="black", font=font)
        draw.rectangle([x, y, x + cell_size - 1, y + cell_size + label_height - 1], outline="lightgray")

    return canvas


def main() -> None:
    if not CHART_PATH.exists():
        raise FileNotFoundError(f"Reference chart not found at {CHART_PATH}")

    image = Image.open(CHART_PATH).convert("RGB")
    print(f"Loaded reference chart: {image.size}, mode={image.mode}")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    BIN_DIR.mkdir(parents=True, exist_ok=True)

    glyphs_for_preview: dict[str, Image.Image] = {}

    for row_idx, letters in GLYPH_ROW_LETTERS.items():
        for col_idx, letter in enumerate(letters):
            raw_cell = crop_cell(image, row_idx, col_idx)
            raw_path = RAW_DIR / f"{letter}.png"
            raw_cell.save(raw_path)

            binary = binarize_and_trim(raw_cell)
            bin_path = BIN_DIR / f"{letter}.png"
            binary.save(bin_path)

            glyphs_for_preview[letter] = binary
            print(f"  [{letter}] raw={raw_cell.size}  binary={binary.size}")

    preview = build_preview(glyphs_for_preview)
    preview.save(PREVIEW_PATH)
    print(f"\nDone. Extracted {len(glyphs_for_preview)} glyphs.")
    print(f"  Raw:     {RAW_DIR}")
    print(f"  Binary:  {BIN_DIR}")
    print(f"  Preview: {PREVIEW_PATH}")


if __name__ == "__main__":
    main()
