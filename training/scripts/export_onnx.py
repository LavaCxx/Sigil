"""把训练好的 TinyGlyphCNN 导出为 ONNX，并用 onnxruntime 验证推理一致性 + 对原始对照表做 sanity check。

用法:
    python export_onnx.py
输出:
    training/checkpoints/nte/model.onnx
    training/checkpoints/nte/sanity_report.json
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import onnx
import onnxruntime as ort
import torch

from dataset import CLASSES, IMG_SIZE, REJECT_INDEX, generate_reject_sample, normalize_contrast
from render import DIGITS, LETTERS, PUNCT, render_glyph
from model import TinyGlyphCNN, count_parameters


ROOT = Path(__file__).resolve().parents[2]
CKPT_PATH = ROOT / "training/checkpoints/nte/best.pt"
ONNX_PATH = ROOT / "training/checkpoints/nte/model.onnx"
ONNX_DATA_PATH = ROOT / "training/checkpoints/nte/model.onnx.data"
SANITY_PATH = ROOT / "training/checkpoints/nte/sanity_report.json"


def preprocess(img: np.ndarray) -> np.ndarray:
    # 与 web 端 patch 协议一致：先对比度归一化，再 (x/255 - 0.5)/0.5
    arr = normalize_contrast(img).astype(np.float32) / 255.0
    arr = (arr - 0.5) / 0.5
    return arr[np.newaxis, np.newaxis, :, :]


def main() -> None:
    ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=False)
    classes = ckpt.get("classes") or ckpt.get("letters")
    if classes is None:
        raise RuntimeError("checkpoint 缺少 classes / letters 字段")

    model = TinyGlyphCNN(num_classes=len(classes))
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    print(f"Loaded model with {count_parameters(model):,} params, {len(classes)} classes")

    dummy = torch.randn(1, 1, IMG_SIZE, IMG_SIZE)
    torch.onnx.export(
        model,
        dummy,
        ONNX_PATH,
        input_names=["input"],
        output_names=["logits"],
        opset_version=17,
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    )

    # Web 端 onnxruntime-web 不支持当前导出格式里的 external data 挂载方式，
    # 必须强制保存为单文件 ONNX（不依赖 model.onnx.data）。
    merged = onnx.load(ONNX_PATH, load_external_data=True)
    onnx.save_model(merged, ONNX_PATH, save_as_external_data=False)
    if ONNX_DATA_PATH.exists():
        ONNX_DATA_PATH.unlink()

    onnx_model = onnx.load(ONNX_PATH, load_external_data=False)
    onnx.checker.check_model(onnx_model)
    size_kb = ONNX_PATH.stat().st_size / 1024
    print(f"ONNX saved to {ONNX_PATH} ({size_kb:.1f} KB)")

    session = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])

    with torch.no_grad():
        torch_logits = model(dummy).numpy()
    onnx_logits = session.run(["logits"], {"input": dummy.numpy()})[0]
    max_diff = float(np.max(np.abs(torch_logits - onnx_logits)))
    print(f"PyTorch vs ONNX max diff: {max_diff:.6f} (should be ~1e-5)")

    print("\n[Sanity check] Recognize each char rendered from its real font:")
    sanity = {
        "classes": list(classes),
        "reject_index": REJECT_INDEX,
        "per_char": {},
        "by_group": {},
        "correct": 0,
        "total": 0,
        "max_diff_pytorch_vs_onnx": max_diff,
    }
    groups = {"letters": LETTERS, "digits": DIGITS, "punct": PUNCT}
    for group_name, chars in groups.items():
        g_correct = 0
        for ch in chars:
            img = render_glyph(ch)
            tensor = preprocess(img)
            logits = session.run(["logits"], {"input": tensor})[0][0]
            probs = np.exp(logits - logits.max())
            probs /= probs.sum()
            pred_idx = int(np.argmax(probs))
            pred_ch = classes[pred_idx]
            confidence = float(probs[pred_idx])
            reject_prob = float(probs[REJECT_INDEX]) if REJECT_INDEX < len(probs) else 0.0
            correct = pred_ch == ch
            sanity["per_char"][ch] = {
                "predicted": pred_ch,
                "confidence": confidence,
                "reject_prob": reject_prob,
                "correct": correct,
            }
            sanity["total"] += 1
            if correct:
                sanity["correct"] += 1
                g_correct += 1
            mark = "OK " if correct else "XX "
            print(f"  [{group_name:>7}] {mark} {ch!r} -> {pred_ch!r}  (conf={confidence:.4f}, reject={reject_prob:.4f})")
        sanity["by_group"][group_name] = {"correct": g_correct, "total": len(chars)}

    sanity["accuracy"] = sanity["correct"] / sanity["total"]
    print(f"\nSanity accuracy on all chars: {sanity['correct']}/{sanity['total']} = {sanity['accuracy']:.4f}")
    for g, d in sanity["by_group"].items():
        print(f"  {g}: {d['correct']}/{d['total']}")

    # 低分辨率 sanity：模拟「原生低清 → 放大回 64 → 对比度归一化」的真实链路，
    # 衡量低分辨率下的识别率(这是灰度管线改造的主要优化目标)。
    print("\n[Low-res sanity] downscale → upscale → normalize:")
    all_chars = list(LETTERS) + list(DIGITS) + list(PUNCT)
    sanity["lowres"] = {}
    for target in (12, 16, 22, 30):
        lr_correct = 0
        wrong: list[str] = []
        for ch in all_chars:
            img = render_glyph(ch)
            small = cv2.resize(img, (target, target), interpolation=cv2.INTER_AREA)
            up = cv2.resize(small, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
            logits = session.run(["logits"], {"input": preprocess(up)})[0][0]
            pred_ch = classes[int(np.argmax(logits))]
            if pred_ch == ch:
                lr_correct += 1
            else:
                wrong.append(f"{ch}->{pred_ch}")
        acc = lr_correct / len(all_chars)
        sanity["lowres"][str(target)] = {"accuracy": acc, "wrong": wrong}
        wrong_str = f"  wrong: {' '.join(wrong)}" if wrong else ""
        print(f"  {target:>2}px: {lr_correct}/{len(all_chars)} = {acc:.4f}{wrong_str}")

    # 额外评估：合成 reject 样本，看模型能否把它们判到 reject 类
    print("\n[Reject check] Synthesize fake non-letter patches and check reject recall:")
    import random as _random
    rng = _random.Random(123)

    reject_total = 100
    reject_correct = 0
    reject_confidences = []
    for _ in range(reject_total):
        fake = generate_reject_sample(rng)
        tensor = preprocess(fake)
        logits = session.run(["logits"], {"input": tensor})[0][0]
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        pred_idx = int(np.argmax(probs))
        reject_confidences.append(float(probs[REJECT_INDEX]))
        if pred_idx == REJECT_INDEX:
            reject_correct += 1
    reject_recall = reject_correct / reject_total
    print(f"  reject recall = {reject_correct}/{reject_total} = {reject_recall:.4f}  "
          f"(avg reject prob on these = {float(np.mean(reject_confidences)):.4f})")
    sanity["reject_recall"] = reject_recall
    sanity["reject_avg_prob_on_fake"] = float(np.mean(reject_confidences))

    SANITY_PATH.write_text(json.dumps(sanity, indent=2))
    print(f"\nSanity report: {SANITY_PATH}")


if __name__ == "__main__":
    main()
