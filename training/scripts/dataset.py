"""GlyphDataset：在线数据增强的字符分类数据集。

数据来源(重大更新)：全部由真字体渲染，不再依赖静态 PNG / 截图描摹。
  - 字母 A-Z      → 密文字体 ToStar.ttf
  - 数字 0-9      → MiSans (游戏 fallback 的正常字体)
  - 标点 . , ! ?… → MiSans
  - reject "_"    → 在线合成的伪样本(噪声/碎片/乱画/双字符/半字)
渲染规格见 render.py：保尺寸 + 基线对齐，所以标点天然小、字母占满字高带。

工作方式：每次 __getitem__ 都从字体重新渲染 + 随机增强，等价于无限样本。

增强策略(针对游戏内文字识别场景，且 *保留相对字号信息*)：
- 轻微仿射(小幅缩放/平移/旋转/错切，幅度受限以免破坏相对字号)
- 透视形变(模拟拍屏)
- 笔画粗细抖动(形态学膨胀/腐蚀)
- 高斯模糊 + 降采样再放大(模拟抗锯齿 / 低分辨率 UI / 失焦)
- 高斯噪声、亮度对比度抖动
- 50% 反色(白底黑字 / 黑底白字都要认)

灰度管线(重大更新)：
web 端 patch 现在从「灰度图 + 对比度归一化」抽取，不再走 Otsu 硬二值——
低分辨率下抗锯齿灰阶是亚像素信息，硬二值会把分离笔画粘连、边缘切成台阶。
因此训练主分布也是灰度退化样本(退化链路末尾不再高概率硬二值)，
仅保留少量硬二值样本兜底；所有样本最后都过 normalize_contrast，
协议与 web 端 segment.ts 的 normalizeContrast 严格一致。
"""

from __future__ import annotations

import random
from functools import lru_cache
from pathlib import Path
from typing import Sequence

import albumentations as A
import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont
from torch.utils.data import Dataset

from render import (
    BASELINE_Y,
    CAP_H,
    CLASSES,
    DIGITS,
    IMG_SIZE,
    LETTERS,
    PUNCT,
    REJECT_INDEX,
    REJECT_LABEL,
    letter_base_images,
    render_glyph,
)

__all__ = [
    "CLASSES",
    "LETTERS",
    "DIGITS",
    "PUNCT",
    "REJECT_LABEL",
    "REJECT_INDEX",
    "IMG_SIZE",
    "GlyphDataset",
    "build_augment_pipeline",
    "generate_reject_sample",
    "normalize_contrast",
]


# 归一化保护：动态范围低于此值的 patch(近空白/纯噪声)不拉伸，避免放大噪声。
# 必须与 web 端 segment.ts 的 NORM_MIN_RANGE 一致。
NORM_MIN_RANGE = 32


# 视为「窗口外填充」的 sentinel 白，不参与对比度分位统计。
# 必须与 web 端 segment.ts 的 NORM_SENTINEL_WHITE 一致。
NORM_SENTINEL_WHITE = 252


def normalize_contrast(img: np.ndarray) -> np.ndarray:
    """patch 级对比度归一化：对内容像素(非 sentinel 255)做 1%/99% 拉伸。

    全图分位会把 sentinel 255 与真实背景(~220)混算，产生 debug patch 外围浅灰矩形。
    实现必须与 web 端 segment.ts 的 normalizeContrast 严格一致。
    """
    flat = img.ravel()
    content = flat[flat < NORM_SENTINEL_WHITE]
    samples = content if content.size >= flat.size * 0.05 else flat

    hist = np.bincount(samples, minlength=256)
    cdf = np.cumsum(hist)
    n = samples.size
    lo = int(np.searchsorted(cdf, n * 0.01))
    hi = int(np.searchsorted(cdf, n * 0.99))
    if hi - lo < NORM_MIN_RANGE:
        return img
    out = (img.astype(np.float32) - lo) * (255.0 / (hi - lo))
    out = np.clip(np.round(out), 0, 255).astype(np.uint8)
    return _whiten_background(out)


def _whiten_background(img: np.ndarray) -> np.ndarray:
    """拉伸后把估计背景漂到 255，与 web 端 whitenBackground 一致。"""
    flat = img.ravel()
    bg = int(np.percentile(flat, 88))
    thr = max(175, bg - 18)
    out = img.copy()
    out.ravel()[flat >= thr] = 255
    return out


def build_augment_pipeline(*, train: bool) -> A.Compose:
    """固定 64×64 输入的增强 pipeline。

    注意：基图已经是规格化的 64×64(保尺寸)，所以这里 *不能* 再做
    LongestMaxSize 之类的"铺满"缩放，否则会破坏标点/字母的相对字号。
    """
    if not train:
        return A.Compose([])  # 验证：基图即输入

    # 只做几何 + 笔画粗细。纹理(模糊/噪声)与硬二值化放到 __getitem__ 里手动做，
    # 以保证顺序：几何 -> 硬二值化(模拟 Otsu) -> 轻度模糊/降采样(模拟 bilinear resize)。
    return A.Compose(
        [
            A.Affine(
                scale=(0.84, 1.14),
                translate_percent=(-0.06, 0.06),
                rotate=(-8, 8),
                shear=(-5, 5),
                fill=255,
                p=0.9,
            ),
            A.Perspective(scale=(0.02, 0.07), fill=255, p=0.3),
            # 游戏字形偏粗：膨胀(加粗)概率明显大于腐蚀(变细)，且允许更大核。
            A.OneOf(
                [
                    A.Morphological(scale=(2, 5), operation="dilation", p=1.0),
                    A.Morphological(scale=(1, 3), operation="dilation", p=1.0),
                    A.Morphological(scale=(1, 2), operation="erosion", p=1.0),
                ],
                p=0.7,
            ),
            A.RandomBrightnessContrast(brightness_limit=0.15, contrast_limit=0.20, p=0.3),
        ]
    )


def _binarize_like_otsu(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """硬二值化(锐利 0/255 边缘)。

    灰度管线下仅作为少数派兜底分布：覆盖高对比 UI 直出(本来就接近二值)
    以及旧二值管线抽取的真实样本的硬边形态。
    """
    t = rng.randint(100, 175)
    return np.where(img >= t, np.uint8(255), np.uint8(0))


def _add_noise(img: np.ndarray, rng: random.Random) -> np.ndarray:
    sigma = rng.uniform(4, 16)
    noisy = img.astype(np.float32) + np.random.normal(0, sigma, img.shape)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def _augment_real(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """真实字形的轻量增广：真实样本本身就是目标分布，只做小扰动防止过拟合到具体像素。

    注意：现存 real_samples.npz 是旧二值管线抽取的(硬 0/255)，新管线 patch 是灰度。
    因此提高模糊概率把硬边柔化、降低再二值化概率，让分布向灰度 patch 靠拢；
    末尾过 normalize_contrast 与推理协议对齐。
    """
    h, w = img.shape
    scale = rng.uniform(0.92, 1.08)
    ang = rng.uniform(-4, 4)
    tx = rng.uniform(-2.5, 2.5)
    ty = rng.uniform(-2.5, 2.5)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, scale)
    M[0, 2] += tx
    M[1, 2] += ty
    img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    if rng.random() < 0.4:
        k = rng.choice([1, 2])
        op = cv2.dilate if rng.random() < 0.5 else cv2.erode
        img = op(img, np.ones((k, k), np.uint8))
    if rng.random() < 0.55:
        img = cv2.GaussianBlur(img, (3, 3), 0)
    if rng.random() < 0.25:
        img = _add_noise(img, rng)
    if rng.random() < 0.3:
        img = _binarize_like_otsu(img, rng)
    return normalize_contrast(img)


def _degrade_like_capture(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """忠实复刻真实截图的退化链路，让模型见到「真实那种被压糊的字」。

    真实链路：游戏以较低分辨率渲染文字 → 截图(可能 JPEG 压缩) → 前端再放大 →
    从灰度抽 patch(bilinear resize) → 对比度归一化。这里照搬：
      1. 缩到一个较小尺寸(模拟原生低清，patch 窗口 ~12~46px，下限压低以覆盖
         用户实际遇到的更低分辨率输入)；
      2. 偶尔叠高斯模糊(缩放/镜头柔化)；
      3. 偶尔 JPEG 压缩(截图常见的块状/振铃伪影)；
      4. 放大回 64(模拟 MIN_DIM 上采样 + patch resize)。
    注意：对比度归一化(normalize_contrast)放在调用方最后一步，对应真实管线。
    """
    target = rng.randint(12, 46)
    small = cv2.resize(img, (target, target), interpolation=cv2.INTER_AREA)
    if rng.random() < 0.5:
        small = cv2.GaussianBlur(small, (3, 3), 0)
    if rng.random() < 0.5:
        q = rng.randint(28, 75)
        ok, enc = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        if ok:
            small = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
    return cv2.resize(small, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)


def _blur_downscale(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """随机降采样再放大，模拟游戏 UI 低分辨率 / 缩放失真(保持 64×64)。"""
    if rng.random() < 0.5:
        small = rng.randint(22, 52)
        down = cv2.resize(img, (small, small), interpolation=cv2.INTER_AREA)
        return cv2.resize(down, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
    return img


# === reject 样本合成 ============================================================
# reject 仅用于"真垃圾"：空白/噪声、被切坏的字符碎片、乱画、未分开的双字符、半个字。
# 标点已经是真实类别，因此不再合成"小块模拟标点"。

def _blank_with_noise(rng: random.Random, size: int = IMG_SIZE) -> np.ndarray:
    img = np.full((size, size), 255, dtype=np.uint8)
    if rng.random() < 0.6:
        n = rng.randint(0, 30)
        for _ in range(n):
            x, y = rng.randrange(size), rng.randrange(size)
            img[y, x] = rng.randint(80, 220)
    return img


def _letter_fragment(rng: random.Random, base_images: dict[str, np.ndarray], size: int = IMG_SIZE) -> np.ndarray:
    """随机取一个字母，只保留一部分，其余补白。模拟分割误把字符切碎。"""
    letter = rng.choice(LETTERS)
    canvas = base_images[letter].copy()
    keep_frac = rng.uniform(0.25, 0.55)
    direction = rng.choice(["left", "right", "top", "bottom", "diag"])
    if direction == "left":
        canvas[:, int(size * keep_frac):] = 255
    elif direction == "right":
        canvas[:, :size - int(size * keep_frac)] = 255
    elif direction == "top":
        canvas[int(size * keep_frac):, :] = 255
    elif direction == "bottom":
        canvas[:size - int(size * keep_frac), :] = 255
    else:
        mask = np.full((size, size), 255, dtype=np.uint8)
        pts = np.array([
            [rng.randint(0, size), rng.randint(0, size)],
            [rng.randint(0, size), rng.randint(0, size)],
            [rng.randint(0, size), rng.randint(0, size)],
        ], dtype=np.int32)
        cv2.fillPoly(mask, [pts], 0)
        canvas = np.where(mask == 0, canvas, 255).astype(np.uint8)
    return canvas


def _partial_vertical(rng: random.Random, base_images: dict[str, np.ndarray], size: int = IMG_SIZE) -> np.ndarray:
    """只保留上半部分(或下半部分)的字母，模拟"上下结构字形只切到上半"的切割残块。"""
    letter = rng.choice(LETTERS)
    canvas = base_images[letter].copy()
    cut = rng.uniform(0.4, 0.6)
    if rng.random() < 0.7:
        canvas[int(size * cut):, :] = 255  # 只留上半
    else:
        canvas[:int(size * cut), :] = 255  # 只留下半
    return canvas


def _random_scribbles(rng: random.Random, size: int = IMG_SIZE) -> np.ndarray:
    img = np.full((size, size), 255, dtype=np.uint8)
    n = rng.randint(3, 8)
    for _ in range(n):
        pts_n = rng.randint(2, 4)
        pts = [(rng.randint(0, size - 1), rng.randint(0, size - 1)) for _ in range(pts_n)]
        thickness = rng.randint(1, 3)
        for i in range(len(pts) - 1):
            cv2.line(img, pts[i], pts[i + 1], 0, thickness=thickness)
    return img


def _two_letters_side_by_side(
    rng: random.Random, base_images: dict[str, np.ndarray], size: int = IMG_SIZE
) -> np.ndarray:
    """两个字母并排压扁，模拟未被正确分开的多字符 patch。"""
    a = base_images[rng.choice(LETTERS)]
    b = base_images[rng.choice(LETTERS)]
    half = size // 2
    left = cv2.resize(a, (half, size), interpolation=cv2.INTER_AREA)
    right = cv2.resize(b, (size - half, size), interpolation=cv2.INTER_AREA)
    return np.hstack([left, right])


# === 颜文字 / 非密文符号 reject 样本 ===========================================
# 游戏文本里偶尔混入颜文字(kaomoji)，其符号 fallback 到普通字体渲染。这些符号
# 数量近乎无穷，无法枚举成类别；正确做法是让模型把它们判为 reject，而不是硬塞成字母。
#
# 关键：必须剔除「和已有目标类长得几乎一样」的符号，否则会拉低真实类召回：
#   - 实心圆 O ↔ ○◯●°、I ↔ │┃、- ↔ ─━、. , ↔ ・。  → 这些一律不放进 reject 池。
# 只保留「形状明显不同」的：片假名、制表符拐角、非圆几何、箭头、CJK 角括号、希腊字母等。
_KAOMOJI_SYMBOLS: Sequence[str] = tuple(
    # 片假名(多笔画、辨识度高)
    list("ツノシミロヮペヾヘメエニヌオワヲヤユヨ")
    # 制表符：只取拐角/交叉(避开纯直线 ─│━┃，免得撞 - / I)
    + list("╯╰╭╮┻┳┣┫┓┏┛┗╬╳┳┻")
    # 非圆几何 / 装饰
    + list("□■◇◆△▽▲▼☆★※♪♡♥◢◣◤◥◈❉✿")
    # 箭头 / 波浪
    + list("↑↓→←⇒⇔〜～⌒")
    # CJK 角括号(与 ASCII () 形状不同)
    + list("「」『』【】〔〕《》〈〉")
    # 希腊 / 其它字母形
    + list("ωσψφθλΔΣΩ")
)

# 候选字体(系统自带，覆盖面广)。训练在本机跑，缺失则跳过。
_SYMBOL_FONT_CANDIDATES = [
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
    ("/System/Library/Fonts/Apple Symbols.ttf", 0),
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/System/Library/Fonts/STHeiti Light.ttc", 0),
]


@lru_cache(maxsize=1)
def _symbol_fonts(px: int = 80) -> list[ImageFont.FreeTypeFont]:
    """加载可用的系统字体(用于渲染颜文字符号)。结果缓存。"""
    fonts: list[ImageFont.FreeTypeFont] = []
    for path, idx in _SYMBOL_FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            fonts.append(ImageFont.truetype(path, px, index=idx))
        except Exception:
            continue
    return fonts


def _symbol_glyph(rng: random.Random, size: int = IMG_SIZE) -> np.ndarray:
    """渲染一个非密文符号(颜文字常见字符)作为 reject 样本。

    流程：大号渲染 → 裁到墨迹 bbox → 缩到随机字高(相对 CAP_H) → 贴到 64×64 画布、
    水平居中并大致对齐大写字带(带抖动)。尺寸/位置贴近真实 patch 抽取分布。
    缺字体或符号无墨迹时回退到乱画样本。
    """
    fonts = _symbol_fonts()
    if not fonts:
        return _random_scribbles(rng, size)

    for _ in range(4):  # 个别符号当前字体画不出(空白)，重试几次
        font = rng.choice(fonts)
        ch = rng.choice(_KAOMOJI_SYMBOLS)
        big = Image.new("L", (160, 160), 255)
        ImageDraw.Draw(big).text((80, 80), ch, fill=0, font=font, anchor="mm")
        arr = np.array(big, dtype=np.uint8)
        ys, xs = np.where(arr < 200)
        if len(xs) == 0:
            continue
        crop = arr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
        ch_h, ch_w = crop.shape
        # 目标字高：相对大写字高随机(0.45~1.1)，宽度按比例并夹住
        target_h = max(6, int(rng.uniform(0.45, 1.1) * CAP_H))
        scale = target_h / ch_h
        target_w = min(int(ch_w * scale), int(size * 0.95))
        target_w = max(4, target_w)
        glyph = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_AREA)

        canvas = np.full((size, size), 255, dtype=np.uint8)
        # 水平居中 + 抖动；垂直让其底部大致落在基线附近(带抖动)
        cx = size // 2 + int(rng.uniform(-4, 4))
        x0 = int(np.clip(cx - target_w // 2, 0, size - target_w))
        baseline = BASELINE_Y + int(rng.uniform(-6, 6))
        y0 = int(np.clip(baseline - target_h, 0, size - target_h))
        canvas[y0: y0 + target_h, x0: x0 + target_w] = np.minimum(
            canvas[y0: y0 + target_h, x0: x0 + target_w], glyph
        )
        return canvas

    return _random_scribbles(rng, size)


REJECT_GENERATORS = [
    ("blank", _blank_with_noise, 1.0),
    ("letter_fragment", _letter_fragment, 1.4),
    ("partial_vertical", _partial_vertical, 1.0),
    ("scribbles", _random_scribbles, 0.7),
    ("two_letters", _two_letters_side_by_side, 0.5),
    ("symbol", _symbol_glyph, 2.2),  # 颜文字符号：权重调高，重点教模型 reject
]


def generate_reject_sample(rng: random.Random, base_images: dict[str, np.ndarray] | None = None) -> np.ndarray:
    """随机挑一种合成器生成一张 64×64 的 reject 灰度图。"""
    if base_images is None:
        base_images = letter_base_images()
    weights = [w for _, _, w in REJECT_GENERATORS]
    name, fn, _ = rng.choices(REJECT_GENERATORS, weights=weights, k=1)[0]
    if name in ("letter_fragment", "two_letters", "partial_vertical"):
        return fn(rng, base_images)
    return fn(rng)


def apply_hard_perturbation(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """对高混淆字符施加更激进的扰动，模拟真实截图里的断笔/粘连/局部遮挡。"""
    out = img.copy()
    h, w = out.shape
    if rng.random() < 0.7:
        for _ in range(rng.randint(1, 3)):
            if rng.random() < 0.5:
                y = rng.randint(0, h - 1)
                t = rng.randint(1, 2)
                out[max(0, y - t): min(h, y + t + 1), :] = 255
            else:
                x = rng.randint(0, w - 1)
                t = rng.randint(1, 2)
                out[:, max(0, x - t): min(w, x + t + 1)] = 255
    if rng.random() < 0.5:
        k = rng.choice([1, 2, 3])
        out = cv2.erode(out, np.ones((k, k), np.uint8), iterations=1)
    if rng.random() < 0.5:
        k = rng.choice([1, 2, 3])
        out = cv2.dilate(out, np.ones((k, k), np.uint8), iterations=1)
    return out


# === Dataset ===================================================================


class GlyphDataset(Dataset):
    """按 `samples_per_class * len(CLASSES)` 生成训练样本，全部由字体在线渲染。

    reject 类样本由 `generate_reject_sample` 在线合成，数量同其他每类。
    `class_boost` 可对指定类过采样(如数字识别率偏低时 {"0": 2.0, ...} 让数字
    在每个 epoch 出现 2 倍)，仅训练集生效。
    """

    def __init__(
        self,
        *,
        samples_per_class: int,
        train: bool,
        invert_prob: float = 0.5,
        hard_chars: Sequence[str] = ("F", "P", "R", "S", "Q", "T", "O"),
        hard_prob: float = 0.25,
        real_X: np.ndarray | None = None,
        real_y: np.ndarray | None = None,
        real_prob: float = 0.0,
        class_boost: dict[str, float] | None = None,
    ) -> None:
        self.samples_per_class = samples_per_class
        self.train = train
        # index → 类别下标的展开表：默认每类 samples_per_class 个，boost 类按倍数过采样。
        boost = class_boost if (train and class_boost) else {}
        self.sample_classes: list[int] = []
        for idx, cls in enumerate(CLASSES):
            count = max(1, round(samples_per_class * float(boost.get(cls, 1.0))))
            self.sample_classes.extend([idx] * count)
        self.invert_prob = invert_prob if train else 0.0
        self.hard_chars = set(hard_chars)
        self.hard_prob = hard_prob if train else 0.0
        # 真实截图抽取的已标注字形（仅训练用）。以 real_prob 概率替换合成样本。
        self.real_X = real_X if train else None
        self.real_y = real_y if train else None
        self.real_prob = real_prob if (train and real_X is not None) else 0.0
        # 按类分组，做「类均衡采样」：稀有真实类(如只有 1 个的 C/?/V)与常见类被等概率抽到，
        # 避免常见类(E/T/N)淹没稀有类，专治「C 被票数更多的 I 盖过」。
        self.real_by_class: dict[int, list[int]] = {}
        if self.real_prob > 0.0 and real_y is not None:
            for i, lbl in enumerate(real_y):
                self.real_by_class.setdefault(int(lbl), []).append(i)
            self.real_classes = list(self.real_by_class.keys())

        self.augment = build_augment_pipeline(train=train)
        self.label_to_index = {cls: idx for idx, cls in enumerate(CLASSES)}
        # 在主进程预渲染所有类别基图(纯 numpy，fork-safe)。
        # 不在 __getitem__ 里调用 PIL/FreeType，避免在 fork 出来的 worker 里共享字体对象出问题。
        self.class_base: dict[str, np.ndarray] = {
            CLASSES[i]: render_glyph(CLASSES[i]) for i in range(len(CLASSES)) if i != REJECT_INDEX
        }
        self.base_images = letter_base_images()

    def __len__(self) -> int:
        return len(self.sample_classes)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        class_idx = self.sample_classes[index]
        rng = random.Random()

        # —— 真实样本通道：以 real_prob 概率改用一张真实字形（类均衡采样 + 轻量增广）——
        if self.real_prob > 0.0 and rng.random() < self.real_prob:
            label = rng.choice(self.real_classes)
            k = rng.choice(self.real_by_class[label])
            img = self.real_X[k].copy()  # type: ignore[index]
            img = _augment_real(img, rng)
            if np.random.random() < self.invert_prob:
                img = 255 - img
            tensor = torch.from_numpy(img).float() / 255.0
            tensor = ((tensor - 0.5) / 0.5).unsqueeze(0)
            return tensor, label

        if class_idx == REJECT_INDEX:
            img = generate_reject_sample(rng, self.base_images)
        else:
            ch = CLASSES[class_idx]
            img = self.class_base[ch].copy()
            if ch in self.hard_chars and rng.random() < self.hard_prob:
                img = apply_hard_perturbation(img, rng)

        img = self.augment(image=img)["image"]
        if self.train:
            # 顺序必须与真实推理管线一致：
            #   低分辨率游戏文字 →(JPEG)→ 放大 → 灰度抽 patch(bilinear resize) → 对比度归一化
            # 大概率走「忠实退化链路」(缩小→模糊/JPEG→放大)，模拟真实截图的糊；
            # 小概率走轻量降采样，保留一些较清晰样本以覆盖高清来源。
            if rng.random() < 0.85:
                img = _degrade_like_capture(img, rng)
            else:
                img = _blur_downscale(img, rng)
            if rng.random() < 0.3:
                img = _add_noise(img, rng)
            # 主分布是灰度(保留抗锯齿/插值中间灰)；少量硬二值兜底高对比直出场景。
            if rng.random() < 0.15:
                img = _binarize_like_otsu(img, rng)
            # 对比度归一化放在最后，对应 web 端 patch 抽取的最后一步
            img = normalize_contrast(img)

        if np.random.random() < self.invert_prob:
            img = 255 - img

        tensor = torch.from_numpy(img).float() / 255.0
        tensor = (tensor - 0.5) / 0.5
        tensor = tensor.unsqueeze(0)
        return tensor, class_idx
