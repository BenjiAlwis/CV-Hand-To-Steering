/**
 * Finding feet in a picture.
 *
 * Built from scratch, deliberately not on the pose graph. The pose graph
 * finds landmarks by first finding a *person*, so a camera close enough to
 * watch a pair of feet — no torso, no head, feet running off the edges —
 * gives it nothing to work with. Measured on real frames from exactly that
 * camera, every combination of model, rotation and crop scored between 0.10
 * and 0.25 against the 0.30 the rig needs.
 *
 * Segmentation has no such requirement: it labels pixels, so a foot is a foot
 * whether or not the leg above it is in shot, and half a foot at the edge of
 * the frame is still half a foot. The multiclass selfie segmenter's body-skin
 * class isolates a bare foot cleanly on those same frames.
 *
 * Two approaches were tried against the frames first and both failed on the
 * evidence: skin-tone thresholding in YCbCr lit up 55% of the picture,
 * because wooden furniture and carpet sit inside the skin locus while a pale
 * sole falls outside it; and frame differencing found the foot only while it
 * moved — 32% of pixels during a press, under 4% holding one.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { findBlobs, openMask, isClipped } from './blobs.js';

const WASM_PATH = '/node_modules/@mediapipe/tasks-vision/wasm';

export const SEGMENTERS = {
  /** Classes: 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 accessories. */
  multiclass: { path: '/assets/models/selfie_multiclass.tflite', classes: [2], withClothes: [2, 4] },
  /** PASCAL VOC, where 15 is person. Coarser, and it swallows the leg with the foot. */
  deeplab: { path: '/assets/models/deeplab_v3.tflite', classes: [15], withClothes: [15] },
};

export class FootDetector {
  /**
   * @param {object} o
   * @param {'multiclass'|'deeplab'} [o.model]
   * @param {boolean} [o.socks]   also accept the clothes class, for socks
   * @param {number} [o.work]     longest edge the segmenter sees
   * @param {number} [o.minArea]  smallest blob worth calling a foot
   */
  constructor({ model = 'multiclass', socks = false, work = 256, minArea = 0.004 } = {}) {
    this.modelName = model;
    this.socks = socks;
    this.work = work;
    this.minArea = minArea;
    this.segmenter = null;
    this.inferenceMs = 0;

    this._canvas = null;
    this._ctx = null;
  }

  get spec() { return SEGMENTERS[this.modelName] ?? SEGMENTERS.multiclass; }

  async load() {
    if (this.segmenter) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.spec.path, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  }

  close() {
    this.segmenter?.close();
    this.segmenter = null;
  }

  /**
   * @param {CanvasImageSource & {videoWidth?: number, width?: number}} source
   * @param {number} stamp strictly increasing, milliseconds
   * @returns {{feet: Array, blobs: Array, mask: {data: Uint8Array, width: number, height: number}}}
   */
  detect(source, stamp) {
    const frame = this._scale(source);
    const began = performance.now();
    const result = this.segmenter.segmentForVideo(frame, stamp);
    this.inferenceMs += (performance.now() - began - this.inferenceMs) * 0.1;

    const category = result?.categoryMask;
    if (!category) return { feet: [], blobs: [], mask: null };

    const width = category.width, height = category.height;
    const raw = category.getAsUint8Array();
    const wanted = this.socks ? this.spec.withClothes : this.spec.classes;

    const mask = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) mask[i] = wanted.includes(raw[i]) ? 1 : 0;
    category.close();

    const cleaned = openMask(mask, width, height);
    const blobs = findBlobs(cleaned, width, height, { minArea: this.minArea });

    return { feet: pickFeet(blobs), blobs, mask: { data: cleaned, width, height } };
  }

  /** Draws the source down to the working size the segmenter runs at. */
  _scale(source) {
    const sw = source.videoWidth ?? source.width;
    const sh = source.videoHeight ?? source.height;
    const longest = Math.max(sw, sh);
    if (longest <= this.work) return source;
    const k = this.work / longest;
    const w = Math.round(sw * k), h = Math.round(sh * k);
    if (!this._canvas || this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = w; this._canvas.height = h;
      this._ctx = this._canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }
    this._ctx.drawImage(source, 0, 0, w, h);
    return this._canvas;
  }
}

/**
 * Decides which blobs are feet, and which is which.
 *
 * At most two, largest first, then named left and right by where they sit
 * across the picture. Naming by position rather than by anatomy is the honest
 * choice here: with no body in shot there is nothing to tell a left foot from
 * a right one, and the camera is looking at the driver, so what is on the
 * left of the picture is the driver's right foot.
 *
 * A single blob is left unnamed. Two feet touching become one region, and
 * guessing which of the two it is would be worse than saying so.
 */
export function pickFeet(blobs) {
  const top = blobs.slice(0, 2);
  if (top.length === 2) {
    const [a, b] = top.slice().sort((p, q) => p.cx - q.cx);
    return [
      { ...a, side: 'right', confidence: confidenceOf(a) },   // mirrored: driver's right
      { ...b, side: 'left', confidence: confidenceOf(b) },
    ];
  }
  return top.map((b) => ({ ...b, side: null, confidence: confidenceOf(b) }));
}

/**
 * How much of a foot this looks like.
 *
 * Area carries most of it, but a box that runs off the edge is discounted:
 * it is still a foot, and still worth reporting, just not one whose extent we
 * actually know.
 */
function confidenceOf(blob) {
  const size = Math.min(1, blob.area / 0.06);
  const edges = Object.values(blob.clipped).filter(Boolean).length;
  return +Math.max(0, Math.min(1, size * (1 - 0.15 * edges))).toFixed(2);
}

export { isClipped };
