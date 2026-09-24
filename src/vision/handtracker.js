/**
 * Camera hand tracking.
 *
 * Wraps MediaPipe's HandLandmarker: runs detection on frames from a camera
 * and publishes the most recent result. It knows nothing about steering —
 * that lives in `input/handsource.js` — so this file stays a thin boundary
 * around the model. Opening the camera itself is `vision/capture.js`, shared
 * with the foot tracker.
 *
 * Both the WASM runtime and the model are served from the project, so the
 * tracker starts with no network connection.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { handMetrics } from './handmath.js';
import { CameraCapture } from './capture.js';

const WASM_PATH = '/node_modules/@mediapipe/tasks-vision/wasm';
const MODEL_PATH = '/assets/models/hand_landmarker.task';

export class HandTracker {
  constructor({ onStatus, exposure = 'auto', capture, confidence } = {}) {
    this.onStatus = onStatus ?? (() => {});

    /** How willing the model is to accept a hand it is unsure about. */
    this.confidence = { detect: 0.35, presence: 0.35, track: 0.30, ...confidence };
    this.landmarker = null;

    /** @type {{hands: Array, at: number, captureAt: number} | null} */
    this.latest = null;

    /** How long the model takes on one frame, in milliseconds. */
    this.inferenceMs = 0;

    this.camera = new CameraCapture({
      capture,
      exposure,
      onStatus: this.onStatus,
      onFrame: (source, stamp, captureAt) => this._detect(source, stamp, captureAt),
    });
  }

  // The camera's own numbers read as the tracker's, as they did when this
  // class owned the stream outright.
  get running() { return this.camera.running; }
  get video() { return this.camera.video; }
  set video(v) { this.camera.video = v; }
  get stream() { return this.camera.stream; }
  get settings() { return this.camera.settings; }
  get fps() { return this.camera.fps; }
  get captureFps() { return this.camera.captureFps; }
  get workSize() { return this.camera.workSize; }
  get capture() { return this.camera.capture; }

  get ready() {
    return this.running && this.latest !== null;
  }

  /**
   * Loosens the model for hands it cannot see the skin of.
   *
   * Measured against photographs of gloves actually being worn: the tracker
   * found a hand in 27% of them at 0.5 confidence against 54% for bare hands,
   * and dropping to 0.1 lifted the gloved figure to 45% while bare hands rose
   * to 72%. Nothing else moved it. Contrast, sharpening and gamma all did
   * worse than leaving the picture alone, and greyscale collapsed it to 10%,
   * which says plainly how much of what the model recognises is skin colour.
   * Cropping tightly to the glove halved it again — the palm detector wants
   * the context around a hand, not a hand filling the frame.
   *
   * The cost of being generous is false positives, which the grip latch and
   * the hand-separation check already throw out: a stray detection cannot
   * steer unless it is also a closed fist a sensible distance from another.
   *
   * @param {{detect?: number, presence?: number, track?: number}} confidence
   */
  async setConfidence(confidence) {
    const next = { ...this.confidence, ...confidence };
    const same = Object.keys(next).every((k) => next[k] === this.confidence[k]);
    if (same && this.landmarker) return;
    this.confidence = next;
    // The thresholds are baked in when the graph is built, so it has to be.
    this.landmarker?.close?.();
    this.landmarker = null;
    await this.load();
  }

  /** Loads the model. Safe to call more than once. */
  async load() {
    if (this.landmarker) return;
    this.onStatus({ state: 'loading', message: 'loading hand model…' });

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      // Loose on purpose, and this is the other half of widening the usable
      // area. A hand at the edge of frame is partly cut off, often angled and
      // often blurred, so the model is less sure about it — tighten these and
      // tracking stops well inside the picture. Tracking confidence is the
      // one that matters most: it decides how long a hand already being
      // followed is kept rather than dropped and re-hunted.
      //
      // The cost of being generous is false positives, which the grip latch
      // and the hand-separation check filter out anyway: a stray detection
      // does not steer unless it is also a closed fist a sensible distance
      // from another one.
      minHandDetectionConfidence: this.confidence.detect,
      minHandPresenceConfidence: this.confidence.presence,
      minTrackingConfidence: this.confidence.track,
    });
  }

  /**
   * Opens the camera and starts detecting.
   * @param {HTMLVideoElement} video      the element to stream into
   * @param {string} [deviceId]           a specific camera
   */
  async start(video, deviceId) {
    if (this.running) return;
    await this.load();

    this.onStatus({ state: 'opening', message: 'opening camera…' });
    await this.camera.open(video, deviceId);

    this.onStatus({ state: 'searching', message: 'looking for your hands…' });
  }

  stop() {
    this.camera.stop();
    this.latest = null;
    this.onStatus({ state: 'off', message: 'camera off' });
  }

  _detect(source, stamp, captureAt) {
    const began = performance.now();
    const result = this.landmarker.detectForVideo(source, stamp);
    this.inferenceMs += (performance.now() - began - this.inferenceMs) * 0.1;

    const hands = (result?.landmarks ?? []).map((landmarks, i) => ({
      landmarks,
      handedness: result.handedness?.[i]?.[0]?.categoryName ?? null,
      ...handMetrics(landmarks),
    }));

    this.latest = { hands, at: performance.now(), captureAt };
  }
}
