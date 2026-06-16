"""可视化数据增强效果：每个字母生成 8 个增强样本，拼成总览图。

用法:
    python preview_augmentation.py
输出:
    training/source/nte/glyphs/augmentation_preview.png
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from dataset import LETTERS, GlyphDataset


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "training/source/nte/glyphs/binary"
OUTPUT_PATH = ROOT / "training/source/nte/glyphs/augmentation_preview.png"
SAMPLES_PER_LETTER = 8


def tensor_to_pil(tensor) -> Image.Image:
    arr = tensor.squeeze(0).numpy()
    arr = (arr * 0.5 + 0.5) * 255.0
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


def main() -> None:
    np.random.seed(0)
    dataset = GlyphDataset(SOURCE_DIR, samples_per_letter=SAMPLES_PER_LETTER, train=True)

    cell = 64
    label_w = 32
    rows = len(LETTERS)
    cols = SAMPLES_PER_LETTER

    canvas = Image.new("RGB", (label_w + cols * cell, rows * cell), "white")
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 18)
    except OSError:
        font = ImageFont.load_default()

    for r, letter in enumerate(LETTERS):
        draw.text((4, r * cell + cell // 2 - 10), letter, fill="black", font=font)
        for c in range(cols):
            idx = c * len(LETTERS) + r
            img, _ = dataset[idx]
            pil = tensor_to_pil(img).convert("RGB")
            canvas.paste(pil, (label_w + c * cell, r * cell))
            draw.rectangle(
                [label_w + c * cell, r * cell, label_w + (c + 1) * cell - 1, (r + 1) * cell - 1],
                outline="lightgray",
            )

    canvas.save(OUTPUT_PATH)
    print(f"Augmentation preview saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
