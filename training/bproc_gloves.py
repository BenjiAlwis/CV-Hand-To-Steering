#!/usr/bin/env python3
# BlenderProc re-launches this file inside its own Blender, and decides
# whether it needs to by checking that its import is the first statement in
# the file. A module docstring counts as a statement, so the description
# below is comments rather than a docstring — otherwise it refuses to run.
import blenderproc as bproc

# Gloved hands rendered with BlenderProc.
#
#     training/.venv/bin/blenderproc run training/bproc_gloves.py -- --count 2000
#
#     # optional, and worth it — real surface textures instead of flat colours
#     training/.venv/bin/blenderproc download cc_textures resources/cc_textures
#     training/.venv/bin/blenderproc run training/bproc_gloves.py -- \
#         --count 2000 --textures resources/cc_textures
#
# BlenderProc over raw Blender for three things that matter here:
#
#   - `bproc.camera.project_points` does the 3D-to-pixel projection, so the
#     keypoints come from the same code path the renderer uses rather than from
#     a projection written by hand that has to be checked against the render
#   - it samples camera poses against a point of interest, so framing a hand
#     that is sometimes cut off by the edge is a parameter rather than
#     arithmetic
#   - CC0 texture and HDRI libraries are one command away, which is the part
#     the raw script cannot match: a glove lit by a real room and surfaced with
#     a real material is much closer to what the camera sees than eight flat
#     colours under an area light
#
# Everything else is the same as `synth_gloves.py`, deliberately: the same
# procedural hand on MediaPipe's 21-landmark topology, in its order, so both
# generators feed the same training set.


import argparse
import json
import math
import os
import random
import sys

import imageio
import numpy as np
from mathutils import Vector

WRIST = 0
FINGERS = {
    "thumb":  ([1, 2, 3, 4],    (0.030, 0.012, 0.004), (0.038, 0.032, 0.024)),
    "index":  ([5, 6, 7, 8],    (0.021, 0.085, 0.000), (0.040, 0.025, 0.020)),
    "middle": ([9, 10, 11, 12], (0.006, 0.089, 0.000), (0.045, 0.028, 0.021)),
    "ring":   ([13, 14, 15, 16], (-0.008, 0.086, 0.000), (0.041, 0.026, 0.020)),
    "pinky":  ([17, 18, 19, 20], (-0.023, 0.079, 0.000), (0.033, 0.020, 0.018)),
}
BONES = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
         (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
         (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17)]


def rotate(vector, axis, angle):
    """Rodrigues, so this file needs nothing but numpy."""
    axis = axis / np.linalg.norm(axis)
    return (vector * math.cos(angle)
            + np.cross(axis, vector) * math.sin(angle)
            + axis * np.dot(axis, vector) * (1 - math.cos(angle)))


def joint_positions(curls, spread, thumb_out):
    """The same hand as synth_gloves.py, so the two sets agree."""
    points = {WRIST: np.zeros(3)}
    for name, (ids, knuckle, lengths) in FINGERS.items():
        base = np.array(knuckle, dtype=float)
        curl = curls[name]
        if name == "thumb":
            direction = np.array([math.cos(thumb_out), math.sin(thumb_out), 0.25])
            axis = np.array([0.2, 0.2, 1.0])
        else:
            fan = spread * (knuckle[0] / 0.023)
            direction = np.array([math.sin(fan), math.cos(fan), 0.0])
            axis = np.array([1.0, 0.0, 0.0])
        direction = direction / np.linalg.norm(direction)

        points[ids[0]] = base.copy()
        here, angle = base.copy(), 0.0
        for i, length in enumerate(lengths):
            angle += curl * (0.55 + 0.35 * i)
            here = here + rotate(direction, axis, angle) * length
            points[ids[i + 1]] = here.copy()
    return np.stack([points[i] for i in range(21)])


def build_hand(points, thickness):
    parts = []
    for a, b in BONES:
        span = points[b] - points[a]
        length = float(np.linalg.norm(span))
        if length < 1e-5:
            continue
        radius = thickness * (1.0 if a in (0, 5, 9, 13, 17) else 0.82)
        bone = bproc.object.create_primitive("CYLINDER", radius=radius, depth=length)
        bone.set_location((points[a] + points[b]) / 2)
        # A cylinder is born standing on +Z; turn that onto the bone. Using
        # mathutils' rotation_difference rather than building an axis-angle by
        # hand, which gets the degenerate cases wrong.
        direction = Vector((span / length).tolist())
        bone.blender_obj.rotation_mode = "QUATERNION"
        bone.blender_obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
        parts.append(bone)

    palm = bproc.object.create_primitive("CUBE")
    palm.set_scale([0.058, 0.085, thickness * 1.7])
    palm.set_location([-0.001, 0.043, 0.0])
    parts.append(palm)

    hand = parts[0].join_with_other_objects(parts[1:])
    hand.set_cp("category_id", 1)
    return hand


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=500)
    ap.add_argument("--out", default="dataset/synth_bproc")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--textures", default=None, help="a downloaded cc_textures folder")
    args = ap.parse_args(argv)

    rng = random.Random(args.seed)
    np.random.seed(args.seed)

    bproc.init()
    bproc.camera.set_resolution(args.size, args.size)
    bproc.renderer.set_max_amount_of_samples(args.samples)
    bproc.renderer.set_output_format(enable_transparency=False)

    materials = []
    if args.textures and os.path.isdir(args.textures):
        materials = bproc.loader.load_ccmaterials(args.textures)
        print(f"  {len(materials)} CC0 materials loaded")

    os.makedirs(os.path.join(args.out, "images"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "labels"), exist_ok=True)

    kept = 0
    for index in range(args.count):
        for existing in bproc.object.get_all_mesh_objects():
            existing.delete()

        style = rng.random()
        base = (rng.uniform(0.85, 1.25) if style < 0.55
                else rng.uniform(0.25, 0.8) if style < 0.8
                else rng.uniform(-0.05, 0.22))
        curls = {n: max(-0.1, base + rng.uniform(-0.22, 0.22)) for n in FINGERS}
        curls["thumb"] *= rng.uniform(0.35, 0.8)
        spread = rng.uniform(-0.12, 0.3) * (1.0 - min(1.0, base))

        local = joint_positions(curls, spread, rng.uniform(2.1, 3.0))
        thickness = rng.uniform(0.0085, 0.016)
        hand = build_hand(local, thickness)

        if materials:
            hand.replace_materials(rng.choice(materials))
        else:
            material = bproc.material.create("glove")
            material.set_principled_shader_value(
                "Base Color", [*[rng.uniform(0.02, 0.6) for _ in range(3)], 1.0])
            material.set_principled_shader_value("Roughness", rng.uniform(0.28, 0.85))
            hand.replace_materials(material)

        hand.set_rotation_euler([rng.uniform(0, math.tau) for _ in range(3)])
        hand.set_location([rng.uniform(-0.03, 0.03) for _ in range(3)])

        # A room's worth of light, from anywhere.
        light = bproc.types.Light()
        light.set_type("AREA")
        light.set_energy(rng.uniform(8, 220))
        angle = rng.uniform(0, math.tau)
        light.set_location([math.cos(angle) * rng.uniform(0.4, 1.6),
                            math.sin(angle) * rng.uniform(0.4, 1.6),
                            rng.uniform(-0.4, 1.4)])
        bproc.renderer.set_world_background([rng.uniform(0.02, 0.6)] * 3)

        matrix = hand.blender_obj.matrix_world
        world_points = np.array([list(matrix @ Vector(p.tolist())) for p in local])

        centre = world_points.mean(axis=0)
        radius = float(np.max(np.linalg.norm(world_points - centre, axis=1)))
        fill = rng.uniform(0.30, 0.95)
        distance = radius / max(0.05, fill * math.tan(bproc.camera.get_fov()[0] / 2))

        azimuth, elevation = rng.uniform(0, math.tau), rng.uniform(-0.9, 1.0)
        position = centre + np.array([
            math.cos(azimuth) * math.cos(elevation) * distance,
            math.sin(azimuth) * math.cos(elevation) * distance,
            math.sin(elevation) * distance])
        # Aimed a little off the hand, so it is sometimes cut off by the edge.
        look_at = centre + np.random.uniform(-0.25, 0.25, 3) * radius
        rotation = bproc.camera.rotation_from_forward_vec(look_at - position)
        bproc.camera.add_camera_pose(
            bproc.math.build_transformation_mat(position, rotation), frame=0)

        data = bproc.renderer.render()

        # The projection BlenderProc itself uses, rather than one written here
        # that would have to be checked against the render.
        pixels = bproc.camera.project_points(world_points)
        keypoints = []
        for (px, py) in pixels:
            inside = 0 <= px < args.size and 0 <= py < args.size
            keypoints.append({"x": round(float(px) / args.size, 5),
                              "y": round(float(py) / args.size, 5),
                              "in_frame": bool(inside)})

        visible = [k for k in keypoints if k["in_frame"]]
        if len(visible) < 12:
            bproc.utility.reset_keyframes()
            continue

        name = f"{index:05d}"
        imageio.imwrite(os.path.join(args.out, "images", f"{name}.png"), data["colors"][0])
        xs = [k["x"] for k in visible]
        ys = [k["y"] for k in visible]
        with open(os.path.join(args.out, "labels", f"{name}.json"), "w") as handle:
            json.dump({"image": f"images/{name}.png", "size": [args.size, args.size],
                       "keypoints": keypoints,
                       "box": [min(xs), min(ys), max(xs), max(ys)],
                       "visible_count": len(visible)}, handle)
        kept += 1
        bproc.utility.reset_keyframes()
        if (index + 1) % 25 == 0:
            print(f"  {index + 1}/{args.count}, {kept} kept", flush=True)

    print(f"\n  {kept} frames in {args.out}\n")


if __name__ == "__main__":
    main()
