#!/usr/bin/env python3
"""
Puts labels into the layout Ultralytics YOLO-pose trains from.

    # the rendered set
    python3 training/to_yolo_pose.py synth --in dataset/synth --out dataset/yolo_hands

    # real footage, once CVAT has exported it as COCO Keypoints 1.0
    python3 training/to_yolo_pose.py cvat --in exports/annotations.json \
        --images exports/images --out dataset/yolo_hands --append

Both sources have to end up in one format or they cannot be trained on
together, and training on both is the point: the rendered frames bring
volume and perfect joints, the real ones bring the leather, the motion blur
and the footwell light that no renderer here is going to invent.

YOLO-pose wants one text file per image, beside it in a parallel `labels`
tree, each line:

    class  cx cy w h  x1 y1 v1  x2 y2 v2  …  x21 y21 v21

all normalised to the image, with visibility 2 for a landmark in shot, 1 for
one inside the frame but hidden behind something, and 0 for one there is no
position for. A landmark off the edge of the picture gets 0: the format has
nowhere to put a coordinate outside the image, so anything else means
inventing one on the border and training on it.
"""
import argparse
import json
import os
import random
import shutil

KEYPOINTS = 21


def write_label(path, rows):
    with open(path, "w") as handle:
        for row in rows:
            handle.write(" ".join(f"{v:.6f}" if isinstance(v, float) else str(v) for v in row) + "\n")


def box_from(points, pad=0.02):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, x1 = max(0.0, min(xs) - pad), min(1.0, max(xs) + pad)
    y0, y1 = max(0.0, min(ys) - pad), min(1.0, max(ys) + pad)
    return ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)


def from_synth(args):
    """The Blender renders, which already carry normalised keypoints."""
    items = []
    for name in sorted(os.listdir(os.path.join(args.inp, "labels"))):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(args.inp, "labels", name)) as handle:
            data = json.load(handle)
        image = os.path.join(args.inp, data["image"])
        if not os.path.exists(image):
            continue

        flat = []
        points = []
        for k in data["keypoints"]:
            if k["in_frame"]:
                x = min(max(k["x"], 0.0), 1.0)
                y = min(max(k["y"], 0.0), 1.0)
                flat += [x, y, 2]
                points.append((x, y))
            else:
                # Off the edge is visibility 0, and the coordinates go to zero
                # with it. The first version clamped them to the border and
                # called them visibility 1 — "known but not visible" — which
                # reads as the honest label and is not: YOLO-pose cannot hold
                # a coordinate outside the image, so clamping invents a
                # position on the edge and then trains on it. Predictions for
                # a hand running out of frame were being dragged to the border
                # and scored against it, and pose mAP sat at exactly zero
                # while detection reached 0.99. Visibility 0 is excluded from
                # both the loss and the metric, which is what is wanted.
                flat += [0.0, 0.0, 0]
        if len(points) < 4:
            continue
        cx, cy, w, h = box_from(points)
        items.append((image, [[0, cx, cy, w, h] + flat]))
    return items


def from_cvat(args):
    """
    CVAT's COCO Keypoints 1.0 export.

    CVAT writes pixels and a top-left origin, which is what YOLO wants too,
    so only the scale changes. Its visibility flags already use the COCO
    convention of 0, 1, 2 and carry straight over.
    """
    with open(args.inp) as handle:
        coco = json.load(handle)

    sizes = {i["id"]: (i["width"], i["height"], i["file_name"]) for i in coco["images"]}
    by_image = {}
    for ann in coco["annotations"]:
        by_image.setdefault(ann["image_id"], []).append(ann)

    items = []
    for image_id, annotations in by_image.items():
        width, height, file_name = sizes[image_id]
        source = os.path.join(args.images, file_name)
        if not os.path.exists(source):
            continue

        rows = []
        for ann in annotations:
            kp = ann.get("keypoints") or []
            if len(kp) < KEYPOINTS * 3:
                continue
            flat, points = [], []
            for i in range(KEYPOINTS):
                x, y, v = kp[i * 3], kp[i * 3 + 1], kp[i * 3 + 2]
                nx, ny = min(max(x / width, 0.0), 1.0), min(max(y / height, 0.0), 1.0)
                flat += [nx, ny, int(v)]
                if v == 2:
                    points.append((nx, ny))
            if not points:
                continue
            if ann.get("bbox"):
                bx, by, bw, bh = ann["bbox"]
                box = ((bx + bw / 2) / width, (by + bh / 2) / height, bw / width, bh / height)
            else:
                box = box_from(points)
            rows.append([0, *box] + flat)
        if rows:
            items.append((source, rows))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", choices=["synth", "cvat"])
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--images", help="where CVAT's images are, for the cvat source")
    ap.add_argument("--out", default="dataset/yolo_hands")
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--append", action="store_true",
                    help="add to what is already there instead of replacing it")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    items = from_synth(args) if args.source == "synth" else from_cvat(args)
    if not items:
        raise SystemExit("  nothing to convert")

    if not args.append and os.path.exists(args.out):
        shutil.rmtree(args.out)
    for split in ("train", "val"):
        os.makedirs(os.path.join(args.out, "images", split), exist_ok=True)
        os.makedirs(os.path.join(args.out, "labels", split), exist_ok=True)

    # Shuffled before splitting, or a rendered set comes out with every dark
    # glove in training and every light one in validation.
    random.Random(args.seed).shuffle(items)
    cut = int(len(items) * (1 - args.val))
    counts = {"train": 0, "val": 0}

    for index, (image, rows) in enumerate(items):
        split = "train" if index < cut else "val"
        stem = f"{args.source}_{index:06d}"
        shutil.copy(image, os.path.join(args.out, "images", split, stem + os.path.splitext(image)[1]))
        write_label(os.path.join(args.out, "labels", split, stem + ".txt"), rows)
        counts[split] += 1

    yaml_path = os.path.join(args.out, "hands.yaml")
    with open(yaml_path, "w") as handle:
        handle.write(
            "# Hands and gloved hands, on MediaPipe's 21-landmark topology.\n"
            f"path: {os.path.abspath(args.out)}\n"
            "train: images/train\n"
            "val: images/val\n\n"
            "kpt_shape: [21, 3]\n"
            "# A horizontal flip turns a left hand into a right one, but the\n"
            "# landmarks keep their meaning — a thumb is still landmark 1 —\n"
            "# so the indices map to themselves.\n"
            f"flip_idx: {list(range(KEYPOINTS))}\n\n"
            "names:\n  0: hand\n")

    print(f"\n  {counts['train']} train, {counts['val']} val → {args.out}")
    print(f"  dataset config: {yaml_path}\n")


if __name__ == "__main__":
    main()
