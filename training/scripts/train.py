"""训练 TinyGlyphCNN 在 NTE 27 类任务上（A-Z + reject）。

用法:
    python train.py [--epochs 20] [--batch-size 128] [--lr 1e-3]
输出:
    training/checkpoints/nte/best.pt          最佳权重
    training/checkpoints/nte/history.json     训练日志
    training/checkpoints/nte/confusion.png    验证集混淆矩阵
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader

from dataset import CLASSES, GlyphDataset
from model import TinyGlyphCNN, count_parameters


ROOT = Path(__file__).resolve().parents[2]
CKPT_DIR = ROOT / "training/checkpoints/nte"


def get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[float, float, np.ndarray]:
    model.eval()
    total_loss = 0.0
    correct = 0
    total = 0
    confusion = np.zeros((len(CLASSES), len(CLASSES)), dtype=np.int64)
    criterion = nn.CrossEntropyLoss()

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            labels = labels.to(device)
            logits = model(images)
            loss = criterion(logits, labels)
            total_loss += loss.item() * labels.size(0)
            preds = logits.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            for p, l in zip(preds.cpu().numpy(), labels.cpu().numpy()):
                confusion[l, p] += 1

    return total_loss / total, correct / total, confusion


def plot_confusion(confusion: np.ndarray, output_path: Path) -> None:
    n = len(CLASSES)
    labels = [c if c != "_" else "rej" for c in CLASSES]
    fig, ax = plt.subplots(figsize=(max(12, n * 0.34), max(11, n * 0.32)))
    im = ax.imshow(confusion, cmap="Blues")
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(labels, fontsize=6)
    ax.set_yticklabels(labels, fontsize=6)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Validation Confusion Matrix (last col/row = reject class)")

    for i in range(n):
        for j in range(n):
            value = confusion[i, j]
            if value == 0:
                continue
            color = "white" if value > confusion.max() / 2 else "black"
            ax.text(j, i, str(value), ha="center", va="center", color=color, fontsize=5)

    fig.colorbar(im, ax=ax)
    fig.tight_layout()
    fig.savefig(output_path, dpi=110)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--train-samples-per-letter", type=int, default=600)
    parser.add_argument("--val-samples-per-letter", type=int, default=100)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    # 数字易与密文字母混淆，全部纳入 hard 扰动集合
    parser.add_argument("--hard-letters", type=str, default="FPRSNQTLIO0123456789")
    parser.add_argument("--hard-prob", type=float, default=0.35)
    parser.add_argument("--boost-classes", type=str, default="0123456789N", help="过采样的类(默认数字+N)")
    parser.add_argument("--boost-factor", type=float, default=2.0, help="过采样倍数")
    parser.add_argument("--focus-letters", type=str, default="N", help="loss 加权重点类")
    parser.add_argument("--focus-weight", type=float, default=2.8, help="重点类 loss 权重")
    parser.add_argument("--resume-from", type=str, default="")
    parser.add_argument("--real-samples", type=str, default="", help="real_samples.npz 路径，混入真实字形微调")
    parser.add_argument("--real-prob", type=float, default=0.0, help="训练时以该概率改用真实字形")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    device = get_device()
    print(f"Device: {device}")

    hard_chars = tuple(ch for ch in args.hard_letters if ch in CLASSES)
    print(f"Hard chars: {''.join(hard_chars) or '<none>'}, hard_prob={args.hard_prob}")
    focus_letters = tuple(ch for ch in args.focus_letters if ch in CLASSES)
    print(f"Focus letters: {''.join(focus_letters) or '<none>'}, focus_weight={args.focus_weight}")

    real_X = real_y = None
    if args.real_samples:
        data = np.load(args.real_samples)
        real_X, real_y = data["X"], data["y"]
        print(f"Real samples: {len(real_y)} glyphs from {args.real_samples}, real_prob={args.real_prob}")

    class_boost = {ch: args.boost_factor for ch in args.boost_classes if ch in CLASSES}
    if class_boost:
        print(f"Class boost: {''.join(class_boost)} ×{args.boost_factor}")

    train_ds = GlyphDataset(
        samples_per_class=args.train_samples_per_letter,
        train=True,
        hard_chars=hard_chars,
        hard_prob=args.hard_prob,
        real_X=real_X,
        real_y=real_y,
        real_prob=args.real_prob,
        class_boost=class_boost,
    )
    val_ds = GlyphDataset(
        samples_per_class=args.val_samples_per_letter,
        train=False,
        hard_chars=hard_chars,
        hard_prob=0.0,
    )

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        persistent_workers=args.num_workers > 0,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        persistent_workers=args.num_workers > 0,
    )

    print(f"Train samples: {len(train_ds):,}  Val samples: {len(val_ds):,}")

    model = TinyGlyphCNN(num_classes=len(CLASSES)).to(device)
    print(f"Model params: {count_parameters(model):,}")

    if args.resume_from:
        resume_path = Path(args.resume_from).expanduser().resolve()
        ckpt = torch.load(resume_path, map_location="cpu", weights_only=False)
        model.load_state_dict(ckpt["model_state"])
        print(f"Resumed from: {resume_path}")

    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    class_weights = torch.ones(len(CLASSES), dtype=torch.float32)
    if focus_letters and args.focus_weight > 1.0:
        for ch in focus_letters:
            idx = CLASSES.index(ch)
            class_weights[idx] = float(args.focus_weight)
    criterion = nn.CrossEntropyLoss(weight=class_weights.to(device))

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    best_path = CKPT_DIR / "best.pt"
    history_path = CKPT_DIR / "history.json"
    confusion_path = CKPT_DIR / "confusion.png"

    best_acc = 0.0
    history: list[dict] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_start = time.time()
        running_loss = 0.0
        running_correct = 0
        running_total = 0

        for images, labels in train_loader:
            images = images.to(device)
            labels = labels.to(device)
            optimizer.zero_grad()
            logits = model(images)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * labels.size(0)
            running_correct += (logits.argmax(dim=1) == labels).sum().item()
            running_total += labels.size(0)

        scheduler.step()
        train_loss = running_loss / running_total
        train_acc = running_correct / running_total

        val_loss, val_acc, confusion = evaluate(model, val_loader, device)
        epoch_time = time.time() - epoch_start

        history.append(
            {
                "epoch": epoch,
                "train_loss": train_loss,
                "train_acc": train_acc,
                "val_loss": val_loss,
                "val_acc": val_acc,
                "lr": scheduler.get_last_lr()[0],
                "time_sec": epoch_time,
            }
        )

        marker = ""
        if val_acc > best_acc:
            best_acc = val_acc
            torch.save({"model_state": model.state_dict(), "classes": list(CLASSES)}, best_path)
            plot_confusion(confusion, confusion_path)
            marker = " <-- new best"

        print(
            f"[{epoch:>2}/{args.epochs}] "
            f"train loss={train_loss:.4f} acc={train_acc:.4f}  "
            f"val loss={val_loss:.4f} acc={val_acc:.4f}  "
            f"lr={scheduler.get_last_lr()[0]:.6f}  "
            f"time={epoch_time:.1f}s{marker}"
        )

    history_path.write_text(json.dumps(history, indent=2))
    print(f"\nBest validation accuracy: {best_acc:.4f}")
    print(f"Checkpoint: {best_path}")
    print(f"History:    {history_path}")
    print(f"Confusion:  {confusion_path}")


if __name__ == "__main__":
    main()
