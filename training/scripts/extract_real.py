"""从真实游戏截图里抽取已标注的字形 patch，供微调使用。

为什么需要它：纯字体渲染 + 合成退化只能逼近真实，无法完全覆盖游戏真实渲染的
细节（笔画连接、抗锯齿后再二值的形状、特定字距）。用真实截图 + 人工已知答案
抽出真·字形，混进训练，能直接把识别率和置信度顶上去。

输入：手动维护的 (图片路径, 每行答案字符串) 清单（答案不含空格，含标点）。
要求每行答案的字符数 == 该行分割出的字形数（脚本会校验，不匹配则跳过并告警，
避免错位污染标签）。

输出：npz，X=(N,64,64) uint8 白底黑字，y=(N,) int 类别下标（与 render.CLASSES 对齐）。

分割/抽取逻辑必须与 apps/web/src/lib/cv/segment.ts 一致：
投影法分割走二值图；patch 像素走灰度图(保留抗锯齿) + 对比度归一化。
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render import CLASSES  # noqa: E402
from dataset import normalize_contrast  # noqa: E402

IMG, CAP, BASE = 64, 44, 52
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASSES)}

# —— 人工标注清单（答案不含空格；逗号/句号/撇/问号等标点要写进去）——
MANIFEST: list[tuple[str, list[str]]] = [
    (
        "/tmp/test_real.png",
        ["NOTEMPER,ONLYWEALTH", "GOAWAY,DON'TINTERRUPTMY", "BUSINESS."],
    ),
    (
        "/tmp/test_real2.png",
        ["DONOTFEEDTHEGHOSTPILLS.", "ISITWORTHSPENDINGMONEYTOHAVE", "ABADEXPERIENCE?"],
    ),
]


def compute_scale(w: int, h: int) -> float:
    lo, sh = max(w, h), min(w, h)
    if lo > 1280:
        return 1280 / lo
    if sh < 480 and lo < 1280:
        return min(1280 / lo, 480 / sh)
    return 1.0


def preprocess(path: str) -> tuple[np.ndarray, np.ndarray]:
    """返回 (binary, gray)，均为白底黑字。binary 供分割，gray 供 patch 抽取。"""
    img0 = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img0 is None:
        raise FileNotFoundError(path)
    h0, w0 = img0.shape
    s = compute_scale(w0, h0)
    img = cv2.resize(img0, (round(w0 * s), round(h0 * s)), interpolation=cv2.INTER_LINEAR)
    _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    if (binary > 0).mean() < 0.5:
        binary = 255 - binary
        img = 255 - img
    return binary, img


def detect_bands(fg: np.ndarray) -> list[tuple[int, int]]:
    H = fg.shape[0]
    rowsum = fg.sum(1)
    bands: list[list[int]] = []
    y = 0
    while y < H:
        if rowsum[y] > 0:
            y0 = y
            while y < H and rowsum[y] > 0:
                y += 1
            bands.append([y0, y])
        else:
            y += 1
    merged: list[list[int]] = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < 6:
            merged[-1][1] = b[1]
        else:
            merged.append(b)
    return [(b[0], b[1]) for b in merged if b[1] - b[0] >= 6]


def tight(fg: np.ndarray, g0: int, g1: int, by0: int, by1: int):
    sub = fg[by0:by1, g0:g1]
    ys, xs = np.where(sub > 0)
    if len(xs) == 0:
        return g0, by0, g1 - g0, by1 - by0, 0
    return g0 + xs.min(), by0 + ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, len(xs)


def extract(gray: np.ndarray, cx: float, capH: int, baselineY: int, cl: int, cr: int) -> np.ndarray:
    """patch 像素来自灰度图，最后做对比度归一化（与 segment.ts extractPatchBand 一致）。"""
    H, W = gray.shape
    S = max(8, round(capH * IMG / CAP))
    bb = (BASE / IMG) * S
    x0 = round(cx - S / 2)
    y0 = round(baselineY - bb)
    buf = np.full((S, S), 255, np.uint8)
    ys0, ys1 = max(0, y0), min(H, y0 + S)
    xs0, xs1 = max(0, x0), min(W, x0 + S)
    for yy in range(ys0, ys1):
        for xx in range(xs0, xs1):
            if xx < cl or xx >= cr:
                continue
            buf[yy - y0, xx - x0] = gray[yy, xx]
    return normalize_contrast(cv2.resize(buf, (IMG, IMG), interpolation=cv2.INTER_LINEAR))


def segment_line(fg: np.ndarray, gray: np.ndarray, by0: int, by1: int) -> list[np.ndarray]:
    W = fg.shape[1]
    band = fg[by0:by1, :]
    col = band.sum(0)
    spans: list[list[int]] = []
    x = 0
    while x < W:
        if col[x] > 0:
            x0 = x
            while x < W and col[x] > 0:
                x += 1
            spans.append([x0, x])
        else:
            x += 1
    if not spans:
        return []
    gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
    med = np.median(gaps) if gaps else 8
    merge_thr = max(3, 0.5 * med)
    gs = [spans[0][:]]
    for sp in spans[1:]:
        if sp[0] - gs[-1][1] < merge_thr:
            gs[-1][1] = sp[1]
        else:
            gs.append(sp[:])
    boxes = [tight(fg, g[0], g[1], by0, by1) for g in gs]
    hts = sorted(b[3] for b in boxes if b[3] > 0)
    maxH = hts[-1]
    capH = max(1, hts[min(len(hts) - 1, int(0.72 * len(hts)))])
    tb = sorted(b[1] + b[3] for b in boxes if b[3] >= 0.6 * maxH)
    baselineY = tb[len(tb) // 2]
    noise = max(2, 0.003 * capH * capH)
    patches: list[np.ndarray] = []
    for gi, g in enumerate(gs):
        bx, byy, bw, bh, area = boxes[gi]
        if area < noise or (bw < 2 and bh < 2):
            continue
        cl, cr = g[0] - 3, g[1] + 3
        if gi > 0:
            cl = max(cl, round((gs[gi - 1][1] + g[0]) / 2))
        if gi < len(gs) - 1:
            cr = min(cr, round((g[1] + gs[gi + 1][0]) / 2))
        patches.append(extract(gray, bx + bw / 2, capH, baselineY, cl, cr))
    return patches


def main() -> None:
    X: list[np.ndarray] = []
    y: list[int] = []
    for path, line_gts in MANIFEST:
        binary, gray = preprocess(path)
        fg = (binary == 0).astype(np.uint8)
        bands = detect_bands(fg)
        if len(bands) != len(line_gts):
            print(f"[WARN] {path}: 检测到 {len(bands)} 行，标注 {len(line_gts)} 行，跳过")
            continue
        for (by0, by1), gt in zip(bands, line_gts):
            patches = segment_line(fg, gray, by0, by1)
            if len(patches) != len(gt):
                print(f"[WARN] {path}: 行 {gt!r} 分割出 {len(patches)} 字，答案 {len(gt)} 字，跳过该行")
                continue
            for patch, ch in zip(patches, gt):
                if ch not in CLASS_TO_IDX:
                    print(f"[WARN] 字符 {ch!r} 不在 CLASSES，跳过")
                    continue
                X.append(patch)
                y.append(CLASS_TO_IDX[ch])
    X_arr = np.stack(X).astype(np.uint8)
    y_arr = np.array(y, dtype=np.int64)
    out = Path(__file__).resolve().parents[1] / "checkpoints" / "nte" / "real_samples.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, X=X_arr, y=y_arr)
    # 覆盖率
    counts: dict[str, int] = {}
    for yi in y_arr:
        c = CLASSES[yi]
        counts[c] = counts.get(c, 0) + 1
    covered = sorted(counts.keys())
    missing = [c for c in CLASSES if c not in counts and c != "_"]
    print(f"\n抽取 {len(y_arr)} 个真实字形 -> {out}")
    print("各类计数:", {k: counts[k] for k in covered})
    print(f"已覆盖 {len(covered)} 类；未覆盖: {''.join(missing)}")


if __name__ == "__main__":
    main()
