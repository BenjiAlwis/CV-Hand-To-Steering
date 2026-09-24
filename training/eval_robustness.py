#!/usr/bin/env python3
"""
Measures what the detector survives.

    training/.venv/bin/python training/eval_robustness.py

"Can it find feet at different orientations and in different light" is not a
question to answer by looking at a few pictures, because the interesting
failures are the ones that happen a third of the time. So each condition is
applied to the whole validation set and scored.

Rotation is by exact quarter turns, where the ground-truth boxes transform
without loss, plus small angles where the box around a rotated box is a
little larger than the truth — that inflation flatters recall slightly and is
noted rather than hidden. Lighting leaves the boxes alone and changes only
the picture, so those numbers are exact.
"""
import argparse
import json
import os

import torch
from PIL import Image, ImageEnhance, ImageFilter
from torchvision.ops import box_iou
from torchvision.transforms import v2

from eval_on_frames import load


def rotate_boxes(boxes, turns, W, H):
    """Quarter turns, anticlockwise, in pixels. Exact."""
    for _ in range(turns % 4):
        boxes = [[b[1], W - b[2], b[3], W - b[0]] for b in boxes]
        W, H = H, W
    return boxes, W, H


def score(model, device, items, root, transform, threshold=0.3, iou_threshold=0.5):
    hits = misses = false_alarms = 0
    for image_id, truth_norm in items:
        path = os.path.join(root, "images", f"{image_id}.jpg")
        image = Image.open(path).convert("RGB")
        W, H = image.size
        boxes = [[b[0] * W, b[1] * H, b[2] * W, b[3] * H] for b in truth_norm]
        image, boxes, W, H = transform(image, boxes, W, H)
        if not boxes:
            continue

        small = image.resize((320, 320), Image.BILINEAR)
        tensor = v2.functional.to_dtype(v2.functional.pil_to_tensor(small), torch.float32, scale=True)
        with torch.no_grad():
            out = model([tensor.to(device)])[0]
        keep = out["scores"] >= threshold
        predicted = out["boxes"][keep].cpu()
        # back to the picture's own pixels
        predicted = predicted * torch.tensor([W / 320, H / 320, W / 320, H / 320])
        truth = torch.tensor(boxes, dtype=torch.float32)

        if len(predicted) == 0:
            misses += len(truth)
            continue
        iou = box_iou(truth, predicted)
        matched = iou.max(dim=1).values >= iou_threshold
        hits += int(matched.sum())
        misses += int((~matched).sum())
        false_alarms += max(0, len(predicted) - int(matched.sum()))

    recall = hits / max(1, hits + misses)
    precision = hits / max(1, hits + false_alarms)
    f1 = 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)
    return recall, precision, f1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="training/runs/feet/best.pt")
    ap.add_argument("--data", default="dataset/openimages/validation")
    ap.add_argument("--limit", type=int, default=160)
    args = ap.parse_args()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model, classes, checkpoint = load(args.checkpoint, device)
    print(f"\n  checkpoint epoch {checkpoint['epoch']}: "
          f"recall {checkpoint['recall']:.3f}, precision {checkpoint['precision']:.3f}\n")

    with open(os.path.join(args.data, "labels.json")) as handle:
        data = json.load(handle)
    items = [(i, [b["box"] for b in v]) for i, v in data["images"].items()][: args.limit]

    def upright(image, boxes, W, H):
        return image, boxes, W, H

    def turn(n):
        def go(image, boxes, W, H):
            image = image.rotate(90 * n, expand=True)
            boxes, W, H = rotate_boxes(boxes, n, W, H)
            return image, boxes, W, H
        return go

    def light(factor):
        def go(image, boxes, W, H):
            return ImageEnhance.Brightness(image).enhance(factor), boxes, W, H
        return go

    def contrast(factor):
        def go(image, boxes, W, H):
            return ImageEnhance.Contrast(image).enhance(factor), boxes, W, H
        return go

    def blur(radius):
        def go(image, boxes, W, H):
            return image.filter(ImageFilter.GaussianBlur(radius)), boxes, W, H
        return go

    base = score(model, device, items, args.data, upright)
    print(f"  {'condition':<26} {'recall':>7} {'prec':>7} {'F1':>7}   vs upright")
    print(f"  {'upright, as shot':<26} {base[0]:>7.3f} {base[1]:>7.3f} {base[2]:>7.3f}")

    conditions = [
        ("rotated 90 deg", turn(1)),
        ("rotated 180 deg", turn(2)),
        ("rotated 270 deg", turn(3)),
        ("very dark (0.35x)", light(0.35)),
        ("dark (0.6x)", light(0.6)),
        ("bright (1.6x)", light(1.6)),
        ("blown out (2.2x)", light(2.2)),
        ("flat, low contrast", contrast(0.45)),
        ("harsh contrast", contrast(1.9)),
        ("motion blur (2px)", blur(2.0)),
        ("heavy blur (4px)", blur(4.0)),
    ]
    for name, transform in conditions:
        recall, precision, f1 = score(model, device, items, args.data, transform)
        delta = f1 - base[2]
        arrow = "same" if abs(delta) < 0.02 else f"{delta:+.3f}"
        print(f"  {name:<26} {recall:>7.3f} {precision:>7.3f} {f1:>7.3f}   {arrow}")
    print()


if __name__ == "__main__":
    main()
