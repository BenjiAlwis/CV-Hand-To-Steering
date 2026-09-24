# Labelling real footage in CVAT

The rendered hands bring volume and exact joints; they do not bring leather,
motion blur, or the light in a footwell. Those have to come from real frames,
and a gloved hand cannot be labelled automatically — the tracker that would do
the labelling is the one that fails on gloves. So this part is by hand, and the
job is to make it as small as possible.

## Running CVAT

CVAT needs Docker, which is not installed on this machine. Once it is:

    git clone https://github.com/cvat-ai/cvat && cd cvat
    docker compose up -d
    docker exec -it cvat_server bash -ic \
        'python3 ~/manage.py createsuperuser'

Then open http://localhost:8080.

## Setting up the task

1. Create a project, open **Raw** under its labels, and paste
   [`hand_skeleton.json`](hand_skeleton.json). That defines a 21-point skeleton
   in MediaPipe's own order, drawn as a hand so an annotator can see which
   point they are dragging, with a `visibility` attribute on every point and
   `gloved` / `side` on the hand itself.
2. Create a task in that project and upload the footage. A video is better than
   loose frames: CVAT interpolates a skeleton between keyframes, and that is
   most of the saving.

## Getting the work down

Labelling 21 points a frame by hand is not worth doing and does not have to be:

- **Interpolate.** Place the skeleton on one frame, move forward twenty, adjust,
  and let CVAT fill the gap. A hand moving at driving speed barely changes in a
  twentieth of a second.
- **Start from what the tracker does catch.** With the Gloves setting on, the
  hand tracker still finds a gloved hand in a fair share of frames. Those are
  free skeletons — export them as pre-annotations and correct rather than draw.
- **Mark occlusion honestly.** `occluded` means the position is known and the
  camera cannot see it; `outside` means it is off the edge of the frame. They
  become visibility 1 and 0 in training, and calling an occluded point
  `outside` teaches the model the finger does not exist.

## Out of CVAT and into training

Export the task as **COCO Keypoints 1.0**, then:

    python3 training/to_yolo_pose.py cvat \
        --in exports/annotations/person_keypoints_default.json \
        --images exports/images \
        --out dataset/yolo_hands --append

`--append` adds the real frames alongside the rendered ones rather than
replacing them, which is the point: train on both.
