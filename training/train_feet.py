#!/usr/bin/env python3
"""
Fine-tunes a foot detector on the Open Images foot set.

    training/.venv/bin/python training/train_feet.py --epochs 20

Starts from SSDLite on MobileNetV3, pretrained on COCO. Starting from scratch
on four thousand boxes would learn edges and blobs and little else; starting
from a detector that already knows what objects look like leaves only the
question of which ones are feet.

The augmentation is the part that matters, and it is chosen from how the
detector actually failed rather than from a list of good practice:

  random crop      A camera watching a pedal sees feet running off the edge
                   of the frame constantly. Crops that deliberately cut feet
                   in half teach that half a foot is still a foot — the one
                   thing the pose graph could never do, since it wanted a
                   whole person before it would admit to a foot at all.
  rotation         A phone propped on the floor is rarely upright, and a
                   detector trained only on level horizons stops working the
                   moment one leans.
  blur and jitter  A foot moving onto a pedal at 30fps is blurred, and floor
                   level is badly lit. Both are the normal case here, not the
                   degraded one.
  horizontal flip  Left and right feet are mirror images, so this doubles the
                   set for free.

Boxes that a crop leaves mostly outside the frame are dropped, but ones merely
clipped are kept and truncated: a box that survives as a sliver teaches the
model that a sliver deserves a full-sized box, which is worse than not
learning from that crop at all.
"""
import argparse
import json
import math
import os
import random
import time

import torch
import torchvision
from PIL import Image, ImageFilter
from torch.utils.data import Dataset, DataLoader
from torchvision.transforms import v2
from torchvision.models.detection.ssdlite import SSDLiteClassificationHead
from torchvision.ops import box_iou


class FeetDataset(Dataset):
    """Open Images boxes, in the xyxy pixels torchvision wants."""

    def __init__(self, root, split, merge=True, train=True, size=320):
        self.dir = os.path.join(root, split)
        with open(os.path.join(self.dir, "labels.json")) as handle:
            data = json.load(handle)
        self.merge = merge
        self.classes = ["foot"] if merge else ["foot", "sock", "footwear"]
        self.train = train
        self.size = size
        self.items = [(i, b) for i, b in data["images"].items()
                      if os.path.exists(os.path.join(self.dir, "images", f"{i}.jpg"))]

    def __len__(self):
        return len(self.items)

    def _label(self, name):
        # A foot in a sock is still a foot to a driver, and the segmenter this
        # replaces could not see one at all.
        return 1 if self.merge else self.classes.index(name) + 1

    def __getitem__(self, index):
        image_id, boxes = self.items[index]
        image = Image.open(os.path.join(self.dir, "images", f"{image_id}.jpg")).convert("RGB")
        W, H = image.size
        xyxy = [[b["box"][0] * W, b["box"][1] * H, b["box"][2] * W, b["box"][3] * H] for b in boxes]
        labels = [self._label(b["label"]) for b in boxes]

        if self.train:
            image, xyxy, labels = self._augment(image, xyxy, labels)
            W, H = image.size

        image = image.resize((self.size, self.size), Image.BILINEAR)
        sx, sy = self.size / W, self.size / H
        scaled = [[b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy] for b in xyxy]

        keep = [i for i, b in enumerate(scaled) if b[2] - b[0] > 2 and b[3] - b[1] > 2]
        target = {
            "boxes": torch.tensor([scaled[i] for i in keep], dtype=torch.float32).reshape(-1, 4),
            "labels": torch.tensor([labels[i] for i in keep], dtype=torch.int64),
        }
        return v2.functional.to_dtype(v2.functional.pil_to_tensor(image), torch.float32, scale=True), target

    def _augment(self, image, boxes, labels):
        W, H = image.size

        if random.random() < 0.5:
            image = image.transpose(Image.FLIP_LEFT_RIGHT)
            boxes = [[W - b[2], b[1], W - b[0], b[3]] for b in boxes]

        # A crop that cuts feet off, which is the case this is all for.
        if random.random() < 0.8:
            scale = random.uniform(0.45, 1.0)
            cw, ch = int(W * scale), int(H * scale)
            cx = random.randint(0, max(0, W - cw))
            cy = random.randint(0, max(0, H - ch))
            image = image.crop((cx, cy, cx + cw, cy + ch))
            kept_boxes, kept_labels = [], []
            for b, l in zip(boxes, labels):
                whole = max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))
                x0, y0 = max(b[0] - cx, 0), max(b[1] - cy, 0)
                x1, y1 = min(b[2] - cx, cw), min(b[3] - cy, ch)
                if x1 <= x0 or y1 <= y0:
                    continue
                # Keep it only if enough survives to be worth learning from.
                if ((x1 - x0) * (y1 - y0)) / whole < 0.25:
                    continue
                kept_boxes.append([x0, y0, x1, y1])
                kept_labels.append(l)
            boxes, labels = kept_boxes, kept_labels
            W, H = image.size

        # A phone on the floor is rarely level.
        if random.random() < 0.35 and boxes:
            angle = random.uniform(-25, 25)
            image = image.rotate(angle, resample=Image.BILINEAR, expand=False)
            rad = math.radians(-angle)
            cx, cy = W / 2, H / 2
            turned = []
            for b in boxes:
                pts = [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]
                xs, ys = [], []
                for px, py in pts:
                    dx, dy = px - cx, py - cy
                    xs.append(cx + dx * math.cos(rad) - dy * math.sin(rad))
                    ys.append(cy + dx * math.sin(rad) + dy * math.cos(rad))
                turned.append([max(0, min(xs)), max(0, min(ys)), min(W, max(xs)), min(H, max(ys))])
            boxes = turned

        if random.random() < 0.3:
            image = image.filter(ImageFilter.GaussianBlur(random.uniform(0.4, 1.8)))
        if random.random() < 0.6:
            image = v2.ColorJitter(brightness=0.45, contrast=0.35, saturation=0.35, hue=0.03)(image)

        return image, boxes, labels


def collate(batch):
    return [b[0] for b in batch], [b[1] for b in batch]


def build(num_classes):
    model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(weights="DEFAULT")
    in_channels = torchvision.models.detection._utils.retrieve_out_channels(model.backbone, (320, 320))
    anchors = model.anchor_generator.num_anchors_per_location()
    norm = torch.nn.BatchNorm2d
    model.head.classification_head = SSDLiteClassificationHead(in_channels, anchors, num_classes, norm)
    return model


@torch.no_grad()
def evaluate(model, loader, device, iou_threshold=0.5, score_threshold=0.3):
    """Recall and precision at one threshold — plain, and enough to steer by."""
    model.eval()
    hits = misses = false_alarms = 0
    for images, targets in loader:
        outputs = model([i.to(device) for i in images])
        for out, target in zip(outputs, targets):
            keep = out["scores"] >= score_threshold
            predicted = out["boxes"][keep].cpu()
            truth = target["boxes"]
            if len(truth) == 0:
                false_alarms += len(predicted)
                continue
            if len(predicted) == 0:
                misses += len(truth)
                continue
            iou = box_iou(truth, predicted)
            matched = (iou.max(dim=1).values >= iou_threshold)
            hits += int(matched.sum())
            misses += int((~matched).sum())
            false_alarms += max(0, len(predicted) - int(matched.sum()))
    recall = hits / max(1, hits + misses)
    precision = hits / max(1, hits + false_alarms)
    return recall, precision


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset/openimages")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--lr", type=float, default=0.005)
    ap.add_argument("--out", default="training/runs/feet")
    ap.add_argument("--separate-classes", action="store_true")
    args = ap.parse_args()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    merge = not args.separate_classes
    train_set = FeetDataset(args.data, "train", merge, train=True)
    val_set = FeetDataset(args.data, "validation", merge, train=False)
    num_classes = len(train_set.classes) + 1

    print(f"  {len(train_set)} training images, {len(val_set)} for validation")
    print(f"  {num_classes - 1} class(es), on {device}\n")

    # Frugal on purpose. An earlier run with four persistent workers on each
    # loader drove a 34GB machine into swap — epochs went from 21 seconds to
    # 905, a forty-fold slowdown that looks exactly like a training problem
    # and is not one. Workers hold decoded images, and six of them alongside
    # an editor and a browser is more than this has to spare.
    train_loader = DataLoader(train_set, batch_size=args.batch, shuffle=True,
                              collate_fn=collate, num_workers=args.workers)
    val_loader = DataLoader(val_set, batch_size=args.batch, shuffle=False,
                            collate_fn=collate, num_workers=0)

    model = build(num_classes).to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    optimiser = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=5e-4, nesterov=True)
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimiser, max_lr=args.lr, total_steps=args.epochs * len(train_loader), pct_start=0.2)

    os.makedirs(args.out, exist_ok=True)
    best = 0.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        started = time.time()
        total = 0.0
        for step, (images, targets) in enumerate(train_loader):
            images = [i.to(device) for i in images]
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            losses = model(images, targets)
            loss = sum(losses.values())
            if not torch.isfinite(loss):
                continue
            optimiser.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 10.0)
            optimiser.step()
            schedule.step()
            total += float(loss.detach())
            if step % 10 == 0:
                print(f"\r  epoch {epoch}/{args.epochs}  step {step}/{len(train_loader)}  "
                      f"loss {total / (step + 1):.3f}", end="", flush=True)

        recall, precision = evaluate(model, val_loader, device)
        print(f"\r  epoch {epoch}/{args.epochs}  loss {total / len(train_loader):.3f}  "
              f"recall {recall:.3f}  precision {precision:.3f}  ({time.time() - started:.0f}s)")

        # F1, not recall. Recall alone is maximised by a model that boxes
        # everything, and selecting on it kept an epoch-1 checkpoint scoring
        # 0.499 recall at 0.014 precision — a detector that says "foot" to the
        # whole picture and is right often enough to look good on one number.
        score = 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)
        if score >= best:
            best = score
            torch.save({"model": model.state_dict(), "classes": train_set.classes,
                        "recall": recall, "precision": precision, "f1": score, "epoch": epoch},
                       os.path.join(args.out, "best.pt"))

    print(f"\n  best F1 {best:.3f} — {args.out}/best.pt\n")


if __name__ == "__main__":
    main()
