#!/usr/bin/env python3
"""
Builds a foot-detection dataset from Open Images.

    python3 training/fetch_openimages.py --out dataset/openimages --limit 1200

Open Images labels "Human foot" with a bounding box, in the wild: feet at
every angle, half out of frame, in shoes, in socks, under tables, lit badly.
That variety is the point. A detector trained on feet photographed neatly
from one side learns the photograph rather than the foot, which is precisely
how the pose graph came to need a whole person in shot before it would admit
a foot existed.

Related classes are kept alongside, because a foot in a sock is still a foot
to a driver, and the segmentation approach this replaces could not see one at
all:

    /m/031n1   Human foot
    /m/01nq26  Sock
    /m/09j5n   Footwear

Annotations are CSV; images come from the public bucket. Nothing here needs
credentials.
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BUCKET = "https://open-images-dataset.s3.amazonaws.com"
ANNOTATIONS = {
    "validation": "https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv",
    "test": "https://storage.googleapis.com/openimages/v5/test-annotations-bbox.csv",
    "train": "https://storage.googleapis.com/openimages/v6/oidv6-train-annotations-bbox.csv",
}
CLASSES = {
    "/m/031n1": "foot", "/m/01nq26": "sock", "/m/09j5n": "footwear",
    # Gloves, and bare hands as the control to measure them against.
    "/m/0174n1": "glove", "/m/0k65p": "hand",
}


def annotations_for(split, cache_dir, wanted):
    """Yields (image_id, label, x0, x1, y0, y1) for the classes we want."""
    path = os.path.join(cache_dir, f"{split}-bbox.csv")
    if not os.path.exists(path):
        print(f"  fetching {split} annotations…", flush=True)
        urllib.request.urlretrieve(ANNOTATIONS[split], path)
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            label = wanted.get(row["LabelName"])
            if label is None:
                continue
            yield (row["ImageID"], label,
                   float(row["XMin"]), float(row["XMax"]),
                   float(row["YMin"]), float(row["YMax"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dataset/openimages")
    ap.add_argument("--splits", default="validation,test")
    ap.add_argument("--limit", type=int, default=0, help="max images per split, 0 for all")
    ap.add_argument("--classes", default="foot,sock,footwear",
                    help="first one listed is the class the set is really about")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--cache", default=".cache/openimages")
    args = ap.parse_args()

    keep = set(args.classes.split(","))
    wanted = {mid: name for mid, name in CLASSES.items() if name in keep}
    if not wanted:
        sys.exit(f"none of {args.classes} are classes I know: {sorted(CLASSES.values())}")

    os.makedirs(args.cache, exist_ok=True)

    for split in args.splits.split(","):
        # Group by image: one image carries every box in it, and a detector
        # trained on an image with one of its two feet marked learns that the
        # unmarked one is background.
        by_image = {}
        for image_id, label, x0, x1, y0, y1 in annotations_for(split, args.cache, wanted):
            by_image.setdefault(image_id, []).append(
                {"label": label, "box": [round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)]})

        # Images actually containing the class asked for come first; the
        # others are there to broaden the set, not to take it over.
        primary = args.classes.split(",")[0]
        order = sorted(by_image, key=lambda k: -sum(b["label"] == primary for b in by_image[k]))
        if args.limit:
            order = order[: args.limit]

        images_dir = os.path.join(args.out, split, "images")
        os.makedirs(images_dir, exist_ok=True)
        print(f"  {split}: {len(order)} images, "
              f"{sum(len(by_image[k]) for k in order)} boxes", flush=True)

        done = [0]

        def fetch(image_id):
            target = os.path.join(images_dir, f"{image_id}.jpg")
            if not os.path.exists(target):
                url = f"{BUCKET}/{split}/{image_id}.jpg"
                try:
                    urllib.request.urlretrieve(url, target)
                except Exception as error:      # a handful 404 or time out
                    return (image_id, str(error))
            done[0] += 1
            if done[0] % 50 == 0:
                print(f"\r  {done[0]}/{len(order)}", end="", flush=True)
            return None

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            failures = [f for f in pool.map(fetch, order) if f]

        labels = {i: by_image[i] for i in order
                  if os.path.exists(os.path.join(images_dir, f"{i}.jpg"))}
        with open(os.path.join(args.out, split, "labels.json"), "w") as handle:
            json.dump({"classes": sorted(keep), "images": labels}, handle)

        print(f"\r  {split}: {len(labels)} images written, {len(failures)} could not be fetched")

    print(f"\n  dataset in {args.out}\n")


if __name__ == "__main__":
    main()
