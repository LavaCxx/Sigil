"""用生成的 nte.ttf 渲染一些英文文本，验证字体可用性。"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
TTF_PATH = ROOT / "training/source/nte/traced/nte.ttf"
OUT_PATH = ROOT / "training/source/nte/traced/preview.png"

SAMPLES = [
    "ABCDEFGHIJKLM",
    "NOPQRSTUVWXYZ",
    "HELLO WORLD",
    "GLYPH LENS",
    "NEVERLESS TO EVERLESS",
]


def main() -> None:
    img = Image.new("RGB", (900, 500), "white")
    draw = ImageDraw.Draw(img)

    for i, text in enumerate(SAMPLES):
        font = ImageFont.truetype(str(TTF_PATH), size=64)
        y = 30 + i * 90
        draw.text((40, y), text, fill="black", font=font)

        label_font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 14)
        draw.text((40, y + 70), text, fill="gray", font=label_font)

    img.save(OUT_PATH)
    print(f"Preview saved to {OUT_PATH}")


if __name__ == "__main__":
    main()
