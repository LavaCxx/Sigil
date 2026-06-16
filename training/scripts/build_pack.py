"""把 NTE 训练产物打包为生产可用的字体包。

输出结构:
    packs/nte/
    ├── meta.json
    ├── mapping.json
    ├── model.onnx
    ├── font.ttf
    └── preview.png

这个目录将来会原样部署到 Web App 的 public/packs/nte/ 下。
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
from PIL import Image

from render import (
    CIPHER_FONT_PATH,
    CLASSES,
    DIGITS,
    LETTERS,
    OUTPUT_FOR_CLASS,
    PUNCT,
    REJECT_INDEX,
    REJECT_LABEL,
    render_glyph,
)


ROOT = Path(__file__).resolve().parents[2]
PACK_DIR = ROOT / "packs/nte"

ONNX_SRC = ROOT / "training/checkpoints/nte/model.onnx"
ONNX_DATA_SRC = ROOT / "training/checkpoints/nte/model.onnx.data"
SANITY_SRC = ROOT / "training/checkpoints/nte/sanity_report.json"
TEMPLATE_SIZE = 64

# 非 reject 类(字母+数字+标点)，顺序与 mapping.output_index_to_letter 的非空项一致。
NON_REJECT_CLASSES = [c for c in CLASSES if c != REJECT_LABEL]


def _build_preview() -> Image.Image:
    """用真字体渲染一张全字符预览(白底)。"""
    cols = 13
    cell = TEMPLATE_SIZE
    rows = (len(NON_REJECT_CLASSES) + cols - 1) // cols
    sheet = np.full((rows * cell, cols * cell), 255, dtype=np.uint8)
    for i, ch in enumerate(NON_REJECT_CLASSES):
        r, c = divmod(i, cols)
        sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = render_glyph(ch)
    return Image.fromarray(sheet)


def main() -> None:
    PACK_DIR.mkdir(parents=True, exist_ok=True)

    shutil.copy(ONNX_SRC, PACK_DIR / "model.onnx")
    # 清理旧的 external data 文件，避免前端误加载失败
    stale_data = PACK_DIR / "model.onnx.data"
    if stale_data.exists():
        stale_data.unlink()
    # pack 字体直接用游戏真密文字体(替代旧的描摹版)
    shutil.copy(CIPHER_FONT_PATH, PACK_DIR / "font.ttf")
    _build_preview().save(PACK_DIR / "preview.png")

    # 生成 templates.bin(模板匹配兜底用)：每个非 reject 类各渲染为 64×64 灰度
    # (保留抗锯齿，与新的灰度 patch 管线一致；NCC 做零均值归一化，对灰阶鲁棒)，
    # 顺序与 output_index_to_letter 的非空项严格一致。
    tmpl_buf = bytearray()
    for ch in NON_REJECT_CLASSES:
        img = render_glyph(ch)
        tmpl_buf.extend(np.ascontiguousarray(img, dtype=np.uint8).tobytes())
    (PACK_DIR / "templates.bin").write_bytes(bytes(tmpl_buf))
    print(f"  templates.bin: {len(NON_REJECT_CLASSES)} classes × {TEMPLATE_SIZE}×{TEMPLATE_SIZE} = {len(tmpl_buf)} bytes")

    sanity = json.loads(SANITY_SRC.read_text())

    onnx_model = onnx.load(str(ONNX_SRC))
    input_info = onnx_model.graph.input[0]
    input_shape = [
        d.dim_value if d.dim_value > 0 else d.dim_param for d in input_info.type.tensor_type.shape.dim
    ]

    # 输出索引 → 字符：字母/数字/标点输出本身，reject 输出空串(前端渲染为 "?")。
    output_chars = [OUTPUT_FOR_CLASS[c] for c in CLASSES]
    mapping = {
        "letters": "".join(LETTERS),
        "digits": "".join(DIGITS),
        "punctuation": "".join(PUNCT),
        "case_sensitive": False,
        "output_index_to_letter": output_chars,
        "reject_class": {
            "index": REJECT_INDEX,
            "label": REJECT_LABEL,
            "render": "?",
        },
        "confidence_threshold": 0.08,
        "model_input": {
            "name": input_info.name,
            "shape": input_shape,
            "dtype": "float32",
            "normalization": "(pixel / 255 - 0.5) / 0.5",
            "contrast_normalization": "percentile_1_99_stretch, min_range=32 (见 segment.ts normalizeContrast)",
            "color_mode": "grayscale",
            "background": "white",
            "foreground": "black",
            "invariant_to_color_polarity": True,
        },
        "model_output": {
            "name": "logits",
            "shape": [-1, len(CLASSES)],
            "interpretation": "raw_logits_apply_softmax",
        },
    }

    meta = {
        "id": "nte",
        "name_zh": "异环",
        "name_en": "Neverless to Everless",
        "abbrev": "NTE",
        "version": "0.5.2",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "developer": "NetEase",
        "script_type": "alphabetic_substitution",
        "script_features": {
            "letter_count": 26,
            "digit_count": len(DIGITS),
            "punctuation_count": len(PUNCT),
            "compound_glyphs": False,
            "case_sensitive": False,
            "rtl": False,
            "has_digits": True,
            "has_punctuation": True,
            "has_reject_class": True,
        },
        "data_provenance": {
            "source": "Official game fonts: ToStar.ttf (cipher letters) + MiSans Latin Demibold (digits/punctuation fallback)",
            "method": "Rendered directly from real fonts with online augmentation (blur/downscale/noise/affine); size-preserving baseline-aligned glyphs; grayscale anti-aliased patches with percentile contrast normalization (digits oversampled)",
            "human_traced": False,
            "verified_against_real_screenshots": False,
        },
        "model": {
            "framework": "ONNX",
            "architecture": "TinyGlyphCNN (3 conv + GAP + FC)",
            "input_size": [64, 64],
            "num_classes": len(CLASSES),
            "file_size_kb": round((PACK_DIR / "model.onnx").stat().st_size / 1024, 1),
            "sanity_accuracy": sanity["accuracy"],
            "reject_recall": sanity.get("reject_recall"),
        },
        "files": {
            "model": "model.onnx",
            "mapping": "mapping.json",
            "font": "font.ttf",
            "preview": "preview.png",
            "templates": "templates.bin",
        },
    }

    (PACK_DIR / "mapping.json").write_text(json.dumps(mapping, indent=2))
    (PACK_DIR / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    print(f"Pack built at {PACK_DIR}")
    for child in sorted(PACK_DIR.iterdir()):
        size_kb = child.stat().st_size / 1024
        print(f"  {child.name:<16}  {size_kb:>8.1f} KB")
    total_kb = sum(c.stat().st_size for c in PACK_DIR.iterdir()) / 1024
    print(f"  {'TOTAL':<16}  {total_kb:>8.1f} KB")


if __name__ == "__main__":
    main()
