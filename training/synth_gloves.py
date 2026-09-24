#!/usr/bin/env python3
"""
Renders labelled gloved hands.

    blender --background --python training/synth_gloves.py -- --count 500 --out dataset/synth

Omniverse Replicator is the obvious tool for this and cannot run here: it
needs Windows or Ubuntu with an RTX card, minimum a 3070, and this is an
Apple M5. Blender does the same job — a posed model, randomised every way
that matters, rendered with the ground truth written out beside it — and runs
natively on this machine. `training/replicator_gloves.py` holds the same
pipeline for Replicator, for a machine that can run it.

The reason synthetic data is worth the trouble here is the labels. A gloved
hand cannot be annotated automatically, because the tracker that would do the
annotating is the thing that fails on gloves; and by hand it is 21 points a
frame. Rendered, the joint positions are known exactly, for nothing, at any
volume.

What comes out, per frame:

    0001.png      the render
    0001.json     21 keypoints in normalised image coordinates, each with
                  whether it is in frame and whether something is in front of
                  it, plus a bounding box and the pose that produced it

The topology is MediaPipe's own, in its order, so a model trained on this
drops into the rig without anything downstream being rewritten.
"""
import argparse
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, Euler, Matrix

# MediaPipe's 21 landmarks, in its order. Anything trained on this has to
# agree with src/vision/handmath.js, which indexes them by number.
WRIST = 0
FINGERS = {
    #            mcp landmark ids      knuckle position (m)   segment lengths (m)
    "thumb":  ([1, 2, 3, 4],           (0.030, 0.012, 0.004), (0.038, 0.032, 0.024)),
    "index":  ([5, 6, 7, 8],           (0.021, 0.085, 0.000), (0.040, 0.025, 0.020)),
    "middle": ([9, 10, 11, 12],        (0.006, 0.089, 0.000), (0.045, 0.028, 0.021)),
    "ring":   ([13, 14, 15, 16],       (-0.008, 0.086, 0.000), (0.041, 0.026, 0.020)),
    "pinky":  ([17, 18, 19, 20],       (-0.023, 0.079, 0.000), (0.033, 0.020, 0.018)),
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def joint_positions(curls, spread, thumb_out):
    """
    Forward kinematics for one hand, in hand-local metres.

    Each finger is a chain hinged about the palm's X axis, every joint curling
    a little more than the one before it — which is what a hand closing round
    a rim actually does, rather than every joint bending by the same amount.
    """
    points = {WRIST: Vector((0.0, 0.0, 0.0))}

    for name, (ids, knuckle, lengths) in FINGERS.items():
        base = Vector(knuckle)
        curl = curls[name]

        if name == "thumb":
            # The thumb sits across the palm rather than along it.
            direction = Vector((math.cos(thumb_out), math.sin(thumb_out), 0.25)).normalized()
            axis = Vector((0.2, 0.2, 1.0)).normalized()
        else:
            # Fingers fan out slightly as they open.
            fan = spread * (knuckle[0] / 0.023)
            direction = Vector((math.sin(fan), math.cos(fan), 0.0)).normalized()
            axis = Vector((1.0, 0.0, 0.0))

        points[ids[0]] = base.copy()
        here = base.copy()
        angle = 0.0
        for i, length in enumerate(lengths):
            # Later joints curl harder: knuckle, then middle, then tip.
            angle += curl * (0.55 + 0.35 * i)
            turned = Matrix.Rotation(angle, 4, axis) @ direction
            here = here + turned * length
            points[ids[i + 1]] = here.copy()

    return [points[i] for i in range(21)]


def build_hand(points, thickness):
    """One mesh: a palm, and a capsule down every bone."""
    bones = [(0, 1), (1, 2), (2, 3), (3, 4),
             (0, 5), (5, 6), (6, 7), (7, 8),
             (5, 9), (9, 10), (10, 11), (11, 12),
             (9, 13), (13, 14), (14, 15), (15, 16),
             (13, 17), (17, 18), (18, 19), (19, 20),
             (0, 17)]

    mesh = bpy.data.meshes.new("hand")
    bm = bmesh.new()

    for a, b in bones:
        start, end = points[a], points[b]
        span = end - start
        length = span.length
        if length < 1e-5:
            continue
        # Thicker near the palm, thinner at the tips, as a glove is.
        radius = thickness * (1.0 if a in (0, 5, 9, 13, 17) else 0.82)
        ring = bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=10,
            radius1=radius, radius2=radius * 0.88, depth=length)
        rotation = Vector((0, 0, 1)).rotation_difference(span.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rotation, verts=ring["verts"])
        bmesh.ops.translate(bm, vec=start + span * 0.5, verts=ring["verts"])

    # The palm, as a flattened box between the wrist and the knuckles.
    palm = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.058, 0.085, thickness * 1.7), verts=palm["verts"])
    bmesh.ops.translate(bm, vec=Vector((-0.001, 0.043, 0.0)), verts=palm["verts"])

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("hand", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def glove_material(rng):
    """Leather-ish, in the colours gloves actually come in."""
    palette = [(0.02, 0.02, 0.02), (0.05, 0.05, 0.06), (0.35, 0.03, 0.03),
               (0.02, 0.06, 0.25), (0.45, 0.42, 0.38), (0.5, 0.18, 0.02),
               (0.9, 0.9, 0.9), (0.08, 0.25, 0.09)]
    base = rng.choice(palette)
    jitter = rng.uniform(0.75, 1.3)

    material = bpy.data.materials.new("glove")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (
        min(1, base[0] * jitter), min(1, base[1] * jitter), min(1, base[2] * jitter), 1)
    bsdf.inputs["Roughness"].default_value = rng.uniform(0.28, 0.85)
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = rng.uniform(0.2, 0.7)
    return material


def light_the_scene(rng):
    """
    Lighting is randomised hard, because it is what the real camera varies
    most: a footwell is dim and side-lit, a desk is flat and bright.
    """
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    ambient = rng.uniform(0.02, 0.6)
    tint = rng.uniform(0.8, 1.2)
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        ambient, ambient * tint, ambient * rng.uniform(0.8, 1.2), 1)

    for _ in range(rng.randint(1, 3)):
        data = bpy.data.lights.new("key", type="AREA")
        data.energy = rng.uniform(8, 220)
        data.size = rng.uniform(0.2, 2.5)
        data.color = (rng.uniform(0.75, 1.0), rng.uniform(0.75, 1.0), rng.uniform(0.7, 1.0))
        lamp = bpy.data.objects.new("key", data)
        bpy.context.collection.objects.link(lamp)
        angle = rng.uniform(0, math.tau)
        height = rng.uniform(-0.4, 1.4)
        lamp.location = Vector((math.cos(angle) * rng.uniform(0.4, 1.6),
                                math.sin(angle) * rng.uniform(0.4, 1.6), height))
        lamp.rotation_euler = (Vector((0, 0, 0)) - lamp.location).to_track_quat("-Z", "Y").to_euler()


def backdrop(rng):
    """Something behind the hand, so it is never cut out against nothing."""
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, rng.uniform(1.6, 5.0), 0))
    plane = bpy.context.object
    plane.rotation_euler = (math.radians(90), 0, rng.uniform(0, math.tau))
    material = bpy.data.materials.new("backdrop")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    shade = rng.uniform(0.03, 0.8)
    bsdf.inputs["Base Color"].default_value = (
        shade * rng.uniform(0.7, 1.3), shade * rng.uniform(0.7, 1.3), shade * rng.uniform(0.7, 1.3), 1)
    bsdf.inputs["Roughness"].default_value = rng.uniform(0.4, 1.0)
    plane.data.materials.append(material)
    return plane


def place_camera(rng, target, radius):
    camera_data = bpy.data.cameras.new("camera")
    camera_data.lens = rng.uniform(22, 48)
    camera = bpy.data.objects.new("camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    # Framed by how much of the picture the hand should fill, rather than by a
    # distance in metres. Picking a distance gave hands forty pixels across in
    # the middle of an empty backdrop — nothing like what a camera watching a
    # wheel sees, and nothing a detector trained on it would recognise.
    fill = rng.uniform(0.30, 0.95)
    distance = radius / max(0.05, fill * math.tan(camera_data.angle / 2))

    # All round the hand, and from below as often as from above, because a
    # camera watching a wheel is rarely level with what it is watching.
    azimuth = rng.uniform(0, math.tau)
    elevation = rng.uniform(-0.9, 1.0)
    camera.location = target + Vector((
        math.cos(azimuth) * math.cos(elevation) * distance,
        math.sin(azimuth) * math.cos(elevation) * distance,
        math.sin(elevation) * distance))
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    # A little off-centre, so the hand is not always dead middle and is
    # sometimes cut off by the edge — which is the case that matters.
    camera.rotation_euler.rotate(Euler((rng.uniform(-0.16, 0.16),
                                        rng.uniform(-0.16, 0.16),
                                        rng.uniform(-0.3, 0.3))))
    return camera


def project(scene, camera, world_points, size):
    """World positions to normalised image coordinates, with visibility."""
    from bpy_extras.object_utils import world_to_camera_view
    out = []
    for point in world_points:
        uv = world_to_camera_view(scene, camera, point)
        inside = 0.0 <= uv.x <= 1.0 and 0.0 <= uv.y <= 1.0 and uv.z > 0
        out.append({
            # Blender's origin is bottom-left; images are top-left.
            "x": round(uv.x, 5), "y": round(1.0 - uv.y, 5),
            "depth": round(uv.z, 5), "in_frame": bool(inside),
        })
    return out


def render_one(index, args, rng, out_dir):
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = args.samples

    # The pose. Grips are the common case, so they are drawn most often, but
    # an open hand has to be in there or the model learns that a hand is a
    # fist and nothing else.
    style = rng.random()
    if style < 0.55:
        base_curl = rng.uniform(0.85, 1.25)          # round a rim
    elif style < 0.8:
        base_curl = rng.uniform(0.25, 0.8)           # half open
    else:
        base_curl = rng.uniform(-0.05, 0.22)         # flat
    curls = {name: max(-0.1, base_curl + rng.uniform(-0.22, 0.22)) for name in FINGERS}
    curls["thumb"] *= rng.uniform(0.35, 0.8)
    spread = rng.uniform(-0.12, 0.3) * (1.0 - min(1.0, base_curl))
    thumb_out = rng.uniform(2.1, 3.0)

    local = joint_positions(curls, spread, thumb_out)
    thickness = rng.uniform(0.0085, 0.016)           # bare-ish through to a thick glove
    hand = build_hand(local, thickness)
    hand.data.materials.append(glove_material(rng))

    # Put the hand anywhere, any way up.
    hand.rotation_euler = Euler((rng.uniform(0, math.tau),
                                 rng.uniform(0, math.tau),
                                 rng.uniform(0, math.tau)))
    hand.location = Vector((rng.uniform(-0.03, 0.03),
                            rng.uniform(-0.03, 0.03),
                            rng.uniform(-0.03, 0.03)))
    if rng.random() < 0.5:
        hand.scale.x = -1.0                          # the other hand
    bpy.context.view_layer.update()

    light_the_scene(rng)
    backdrop(rng)
    world_points_pre = [hand.matrix_world @ p for p in local]
    centre = sum(world_points_pre, Vector((0, 0, 0))) / len(world_points_pre)
    radius = max((p - centre).length for p in world_points_pre)
    camera = place_camera(rng, centre, radius)
    bpy.context.view_layer.update()

    world_points = [hand.matrix_world @ p for p in local]
    keypoints = project(scene, camera, world_points, args.size)

    name = f"{index:05d}"
    scene.render.filepath = os.path.join(out_dir, "images", f"{name}.png")
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)

    visible = [k for k in keypoints if k["in_frame"]]
    if len(visible) < args.min_visible:
        os.remove(scene.render.filepath)
        return False

    xs = [k["x"] for k in visible]
    ys = [k["y"] for k in visible]
    with open(os.path.join(out_dir, "labels", f"{name}.json"), "w") as handle:
        json.dump({
            "image": f"images/{name}.png",
            "size": [args.size, args.size],
            "keypoints": keypoints,
            "box": [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)],
            "visible_count": len(visible),
            "pose": {"curls": {k: round(v, 4) for k, v in curls.items()},
                     "spread": round(spread, 4), "thickness": round(thickness, 5)},
        }, handle)
    return True


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--out", default="dataset/synth")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--min-visible", type=int, default=12,
                    help="frames showing fewer landmarks than this are thrown away")
    args = ap.parse_args(argv)

    rng = random.Random(args.seed)
    os.makedirs(os.path.join(args.out, "images"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "labels"), exist_ok=True)

    kept = 0
    for i in range(args.count):
        if render_one(i, args, rng, args.out):
            kept += 1
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{args.count} rendered, {kept} kept", flush=True)

    print(f"\n  {kept} of {args.count} frames kept in {args.out}\n")


if __name__ == "__main__":
    main()
