"""Phase 0 字体分析脚本：提取元信息、统计 cmap 覆盖范围、采样 glyph 信息。

用法:
    python inspect_font.py <path_to_font>
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from fontTools.ttLib import TTFont


UNICODE_BLOCKS: list[tuple[int, int, str]] = [
    (0x0000, 0x007F, "Basic Latin"),
    (0x0080, 0x00FF, "Latin-1 Supplement"),
    (0x0100, 0x017F, "Latin Extended-A"),
    (0x0180, 0x024F, "Latin Extended-B"),
    (0x0370, 0x03FF, "Greek and Coptic"),
    (0x0400, 0x04FF, "Cyrillic"),
    (0x0500, 0x052F, "Cyrillic Supplement"),
    (0x0590, 0x05FF, "Hebrew"),
    (0x0600, 0x06FF, "Arabic"),
    (0x0900, 0x097F, "Devanagari"),
    (0x0E00, 0x0E7F, "Thai"),
    (0x1100, 0x11FF, "Hangul Jamo"),
    (0x2000, 0x206F, "General Punctuation"),
    (0x2070, 0x209F, "Super/Subscripts"),
    (0x20A0, 0x20CF, "Currency Symbols"),
    (0x2100, 0x214F, "Letterlike Symbols"),
    (0x2150, 0x218F, "Number Forms"),
    (0x2190, 0x21FF, "Arrows"),
    (0x2200, 0x22FF, "Mathematical Operators"),
    (0x2400, 0x243F, "Control Pictures"),
    (0x2500, 0x257F, "Box Drawing"),
    (0x2580, 0x259F, "Block Elements"),
    (0x25A0, 0x25FF, "Geometric Shapes"),
    (0x2600, 0x26FF, "Miscellaneous Symbols"),
    (0x2700, 0x27BF, "Dingbats"),
    (0x3000, 0x303F, "CJK Symbols and Punctuation"),
    (0x3040, 0x309F, "Hiragana"),
    (0x30A0, 0x30FF, "Katakana"),
    (0x3400, 0x4DBF, "CJK Unified Ideographs Extension A"),
    (0x4E00, 0x9FFF, "CJK Unified Ideographs"),
    (0xAC00, 0xD7AF, "Hangul Syllables"),
    (0xE000, 0xF8FF, "Private Use Area"),
    (0xF900, 0xFAFF, "CJK Compatibility Ideographs"),
    (0xFB00, 0xFB4F, "Alphabetic Presentation Forms"),
    (0x10000, 0x1FFFF, "SMP (Plane 1)"),
    (0xF0000, 0xFFFFF, "Supplementary Private Use Area-A"),
    (0x100000, 0x10FFFF, "Supplementary Private Use Area-B"),
]


def block_of(codepoint: int) -> str:
    for start, end, name in UNICODE_BLOCKS:
        if start <= codepoint <= end:
            return name
    return f"Other (U+{codepoint:04X})"


def inspect(font_path: Path) -> None:
    font = TTFont(font_path, lazy=True)

    print("=" * 72)
    print(f"FILE: {font_path}")
    print(f"SIZE: {font_path.stat().st_size:,} bytes")
    print("=" * 72)

    print("\n[Tables]")
    print(", ".join(sorted(font.keys())))

    name_table = font["name"]
    print("\n[Name records]")
    interesting_ids = {1: "Family", 2: "Subfamily", 4: "Full name", 5: "Version", 6: "PostScript", 7: "Trademark", 8: "Manufacturer", 9: "Designer", 10: "Description", 11: "URL Vendor", 13: "License"}
    seen: set[tuple[int, str]] = set()
    for record in name_table.names:
        if record.nameID not in interesting_ids:
            continue
        try:
            value = record.toUnicode()
        except Exception:
            continue
        key = (record.nameID, value)
        if key in seen:
            continue
        seen.add(key)
        label = interesting_ids[record.nameID]
        print(f"  [{record.nameID:>2}] {label:<14} = {value!r}")

    cmap = font.getBestCmap()
    total = len(cmap)
    print(f"\n[cmap] Total mapped codepoints: {total:,}")

    if total == 0:
        print("  WARNING: No cmap entries! Font may be glyph-only.")
        return

    block_counts: Counter[str] = Counter()
    for codepoint in cmap:
        block_counts[block_of(codepoint)] += 1

    print("\n[Unicode block distribution]")
    for block, count in block_counts.most_common():
        pct = count / total * 100
        print(f"  {count:>6,} ({pct:>5.1f}%)  {block}")

    print("\n[ASCII letter mapping check] (Are A-Z / a-z mapped?)")
    ascii_letters = [chr(c) for c in range(ord("A"), ord("Z") + 1)] + [chr(c) for c in range(ord("a"), ord("z") + 1)]
    mapped_letters = [letter for letter in ascii_letters if ord(letter) in cmap]
    print(f"  Mapped: {len(mapped_letters)}/52")
    if mapped_letters:
        print(f"  Letters present: {''.join(mapped_letters)}")

    print("\n[Sample of mapped codepoints] (first 30)")
    for cp in sorted(cmap.keys())[:30]:
        try:
            ch = chr(cp)
        except ValueError:
            ch = "?"
        print(f"  U+{cp:05X}  glyph={cmap[cp]!r}  char={ch!r}")

    print("\n[Sample around Private Use Area]")
    pua_codepoints = [cp for cp in cmap if 0xE000 <= cp <= 0xF8FF]
    if pua_codepoints:
        print(f"  Total PUA codepoints: {len(pua_codepoints)}")
        for cp in sorted(pua_codepoints)[:10]:
            print(f"  U+{cp:05X}  glyph={cmap[cp]!r}")
    else:
        print("  None.")

    print("\n[OS/2 metadata]")
    if "OS/2" in font:
        os2 = font["OS/2"]
        for attr in ("achVendID", "usWeightClass", "usWidthClass", "fsType", "panose"):
            if hasattr(os2, attr):
                value = getattr(os2, attr)
                if attr == "panose":
                    value = bytes(value) if hasattr(value, "panClass") else value
                print(f"  {attr} = {value!r}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    inspect(Path(sys.argv[1]).resolve())
