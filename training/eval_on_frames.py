#!/usr/bin/env python3
"""
Runs a trained foot detector over real frames and draws what it found.

    training/.venv/bin/python training/eval_on_frames.py \
        --checkpoint training/runs/feet/best.pt --frames some/folder --out out/folder

The validation numbers are measured on Open Images, which is mostly people
standing at a distance. The camera this is for sees one or two feet close up,
often cut off by the frame. Those are different problems, and a model can do
well on the first while being useless at the second, so the frames from the
real camera are the test that decides anything.
"""
import argparse
import glob
import os

import torch
import torchvision
from PIL import Image, ImageDraw
from torchvision.models.detection.ssdlite import SSDLiteClassificationHead
from torchvision.transforms import v2


def load(checkpoint_path, device):
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    classes = checkpoint["classes"]
    model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(weights=None,
                                                                      weights_backbone=None)
    in_channels = torchvision.models.detection._utils.retrieve_out_channels(model.backbone, (320, 320))
    anchors = model.anchor_generator.num_anchors_per_location()
    model.head.classification_head = SSDLiteClassificationHead(
        in_channels, anchors, len(classes) + 1, torch.nn.BatchNorm2d)
    model.load_state_dict(checkpoint["model"])
    model.eval().to(device)
    return model, classes, checkpoint


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="training/runs/feet/best.pt")
    ap.add_argument("--frames", required=True)
    ap.add_argument("--out", default="training/runs/feet/frames")
    ap.add_argument("--score", type=float, default=0.3)
    args = ap.parse_args()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model, classes, checkpoint = load(args.checkpoint, device)
    print(f"\n  checkpoint from epoch {checkpoint['epoch']} — "
          f"recall {checkpoint['recall']:.3f}, precision {checkpoint['precision']:.3f}"
          f"{', F1 %.3f' % checkpoint['f1'] if 'f1' in checkpoint else ''}")
    print(f"  classes: {classes}, on {device}\n")

    os.makedirs(args.out, exist_ok=True)
    paths = sorted(glob.glob(os.path.join(args.frames, "*.png")) +
                   glob.glob(os.path.join(args.frames, "*.jpg")))
    if not paths:
        print(f"  nothing to look at in {args.frames}\n")
        return

    found = 0
    for path in paths:
        image = Image.open(path).convert("RGB")
        W, H = image.size
        small = image.resize((320, 320), Image.BILINEAR)
        tensor = v2.functional.to_dtype(v2.functional.pil_to_tensor(small), torch.float32, scale=True)
        with torch.no_grad():
            out = model([tensor.to(device)])[0]

        keep = out["scores"] >= args.score
        boxes = out["boxes"][keep].cpu().tolist()
        scores = out["scores"][keep].cpu().tolist()
        found += len(boxes)

        draw = ImageDraw.Draw(image)
        for box, score in zip(boxes, scores):
            # Back from the square the model saw to the real picture.
            x0, y0, x1, y1 = box[0] / 320 * W, box[1] / 320 * H, box[2] / 320 * W, box[3] / 320 * H
            draw.rectangle([x0, y0, x1, y1], outline=(47, 224, 122), width=max(2, W // 220))
            draw.text((x0 + 4, max(0, y0 - 12)), f"foot {score:.2f}", fill=(47, 224, 122))
        image.save(os.path.join(args.out, os.path.basename(path)))
        print(f"  {os.path.basename(path)}: {len(boxes)} box(es) "
              f"{'· ' + ', '.join(f'{s:.2f}' for s in scores) if scores else ''}")

    print(f"\n  {found} boxes over {len(paths)} frames, written to {args.out}\n")


if __name__ == "__main__":
    main()
