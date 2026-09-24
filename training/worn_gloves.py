#!/usr/bin/env python3
"""
Builds the only glove set worth measuring on: gloves actually being worn.

    python3 training/worn_gloves.py --splits validation,test --out dataset/worn

Open Images labels "Glove" on anything glove-shaped, and most of them are not
on anybody — product photographs of empty gloves, a baseball glove on the
grass, a racing suit on a mannequin. Measuring a hand tracker against that set
says almost nothing: it scored 18% where bare hands scored 54%, and most of
the gap was pictures with no hand in them at all rather than any difficulty
with gloves.

A glove is being worn when its box substantially overlaps a "Human hand" box
in the same picture. That is the subset a hand tracker can fairly be asked
about.
"""
import argparse
import csv
import json
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

GLOVE, HAND = "/m/0174n1", "/m/0k65p"
BUCKET = "https://open-images-dataset.s3.amazonaws.com"


def overlap(a, b):
    """Intersection over the smaller box — a glove inside a hand box counts."""
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    inter = (x1 - x0) * (y1 - y0)
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return inter / max(1e-9, smaller)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--splits", default="validation,test")
    ap.add_argument("--out", default="dataset/worn")
    ap.add_argument("--cache", default=".cache/openimages")
    ap.add_argument("--min-overlap", type=float, default=0.3)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    for split in args.splits.split(","):
        path = os.path.join(args.cache, f"{split}-bbox.csv")
        found = {}
        with open(path, newline="") as handle:
            for row in csv.DictReader(handle):
                if row["LabelName"] not in (GLOVE, HAND):
                    continue
                box = [float(row["XMin"]), float(row["YMin"]), float(row["XMax"]), float(row["YMax"])]
                found.setdefault(row["ImageID"], {}).setdefault(row["LabelName"], []).append(box)

        worn = {}
        for image_id, labels in found.items():
            gloves = labels.get(GLOVE, [])
            hands = labels.get(HAND, [])
            pairs = [g for g in gloves if any(overlap(g, h) >= args.min_overlap for h in hands)]
            if pairs:
                worn[image_id] = [{"label": "worn_glove", "box": [round(v, 5) for v in g]} for g in pairs]

        images_dir = os.path.join(args.out, split, "images")
        os.makedirs(images_dir, exist_ok=True)
        print(f"  {split}: {len(worn)} images with a glove on a hand, "
              f"{sum(len(v) for v in worn.values())} boxes")

        def fetch(image_id):
            target = os.path.join(images_dir, f"{image_id}.jpg")
            if os.path.exists(target):
                return None
            try:
                urllib.request.urlretrieve(f"{BUCKET}/{split}/{image_id}.jpg", target)
            except Exception as error:
                return (image_id, str(error))
            return None

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(fetch, worn))

        kept = {i: v for i, v in worn.items()
                if os.path.exists(os.path.join(images_dir, f"{i}.jpg"))}
        with open(os.path.join(args.out, split, "labels.json"), "w") as handle:
            json.dump({"classes": ["worn_glove"], "images": kept}, handle)
        print(f"  {split}: {len(kept)} written")

    print(f"\n  in {args.out}\n")


if __name__ == "__main__":
    main()
