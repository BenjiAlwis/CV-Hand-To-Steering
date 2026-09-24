#!/usr/bin/env python3
"""
The same dataset, in NVIDIA Omniverse Replicator.

    ./python.sh training/replicator_gloves.py            # Isaac Sim / Code
    kit --exec "training/replicator_gloves.py"

UNTESTED. Written from the Replicator API but never run, because it cannot be
run here: Omniverse Kit supports Windows 11 and Ubuntu on an NVIDIA RTX card,
minimum a 3070, and this project lives on an Apple M5. macOS is not a
supported platform for Kit at all. Treat this as a starting point on a
machine that has the hardware, not as something known to work.

What Replicator buys over the Blender script beside it, which does run here:

  - path-traced renders rather than rasterised, so the leather, the sheen and
    the shadows are closer to what a camera sees, which is the whole sim-to-real
    problem
  - annotators that come with it, so keypoints, 2D and 3D boxes, instance and
    semantic segmentation all fall out without being projected by hand
  - randomisation of materials and HDRI lighting from libraries rather than
    from the handful of colours and area lights the Blender script invents
  - it scales across GPUs, so hundreds of thousands of frames is a machine
    question rather than a patience one

What it needs that this file does not carry: a rigged hand USD with a glove
material. The obvious sources are a MANO-derived hand, a purchased rigged
hand asset, or the SimReady assets NVIDIA ship. The joint names below have to
be mapped onto whatever that rig actually calls them, and `HAND_USD` pointed
at it.
"""
import omni.replicator.core as rep

HAND_USD = "omniverse://localhost/Projects/wheelhouse/gloved_hand.usd"
OUT_DIR = "dataset/synth_replicator"
FRAMES = 20000
RESOLUTION = (256, 256)

# MediaPipe's 21, in its order. These must line up with the rig's joints, and
# with src/vision/handmath.js, which indexes them by number.
JOINTS = [
    "wrist",
    "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
    "index_mcp", "index_pip", "index_dip", "index_tip",
    "middle_mcp", "middle_pip", "middle_dip", "middle_tip",
    "ring_mcp", "ring_pip", "ring_dip", "ring_tip",
    "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip",
]


def main():
    rep.settings.set_render_pathtraced(samples_per_pixel=64)

    hand = rep.create.from_usd(HAND_USD, semantics=[("class", "gloved_hand")])
    camera = rep.create.camera(focal_length=rep.distribution.uniform(18, 50))
    render_product = rep.create.render_product(camera, RESOLUTION)

    # A dome light doing the work a real room does, turned every which way.
    dome = rep.create.light(light_type="Dome")

    with rep.trigger.on_frame(num_frames=FRAMES):
        # The pose. Grips are the common case but an open hand has to be in
        # there, or the model learns that a hand is a fist and nothing else.
        with hand:
            rep.modify.pose(
                position=rep.distribution.uniform((-0.05, -0.05, -0.05), (0.05, 0.05, 0.05)),
                rotation=rep.distribution.uniform((-180, -180, -180), (180, 180, 180)),
            )
            # Curl every finger independently, through the whole range.
            for finger in ("thumb", "index", "middle", "ring", "pinky"):
                rep.modify.attribute(
                    f"inputs:{finger}_curl",
                    rep.distribution.uniform(-0.1, 1.3),
                )
            # Leather, suede, nomex, wet, worn.
            rep.randomizer.materials(
                rep.get.material(path_pattern="/World/Looks/glove_*"))

        with dome:
            rep.modify.attribute("inputs:intensity", rep.distribution.uniform(80, 3000))
            rep.modify.attribute("inputs:texture:file",
                                 rep.distribution.choice(rep.utils.get_usd_files("/hdri")))
            rep.modify.pose(rotation=rep.distribution.uniform((0, -180, 0), (0, 180, 0)))

        # Framed on the hand, close, from any angle including below — a camera
        # watching a wheel is rarely level with what it is watching, and the
        # hand should sometimes run off the edge of the frame.
        with camera:
            rep.modify.pose(
                position=rep.distribution.uniform((-0.5, -0.5, -0.4), (0.5, 0.5, 0.5)),
                look_at=hand,
            )

    writer = rep.WriterRegistry.get("BasicWriter")
    writer.initialize(
        output_dir=OUT_DIR,
        rgb=True,
        bounding_box_2d_tight=True,
        bounding_box_3d=True,
        instance_segmentation=True,
        semantic_segmentation=True,
        # The keypoints, which is the reason for any of this: a gloved hand
        # cannot be labelled automatically, because the tracker that would do
        # the labelling is the thing that fails on gloves.
        skeleton_data=True,
        camera_params=True,
    )
    writer.attach([render_product])

    rep.orchestrator.run()


if __name__ == "__main__":
    main()
