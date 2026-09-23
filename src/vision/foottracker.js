/**
 * Camera foot tracking.
 *
 * The same shape as `handtracker.js`, around MediaPipe's PoseLandmarker
 * instead: it runs on the second camera, finds the driver's feet, and
 * publishes them. What a foot *means* is `input/pedalsource.js`.
 *
 * Pose rather than hands because there is no foot model — the pose graph is
 * the only one that carries ankles, heels and toes. It costs more per frame
 * than the hand model, which is why this runs on a lower frame budget and a
 * smaller working frame: a pedal moves at a fraction of the speed a hand
 * does, and steering must keep the GPU it needs.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { footMetrics } from './footmath.js';
import { CameraCapture } from './capture.js';

const WASM_PATH = '/node_modules/@mediapipe/tasks-vision/wasm';
/**
 * `full` rather than `lite`, which is the difference between a foot camera
 * that works and one that mostly does not.
 *
 * The pose graph finds a *person* before it finds any landmark, so a camera
 * showing only feet gives it very little to go on — which is exactly why
 * tracking improved when the feet were further away and more of the body was
 * in shot. `full` is markedly better at a partial body, and the extra
 * milliseconds are affordable here because the feet run at a fraction of the
 * hand tracker's rate.
 */
const MODELS = {
  lite: '/assets/models/pose_landmarker_lite.task',
  full: '/assets/models/pose_landmarker_full.task',
};

export class FootTracker {
  constructor({ onStatus, capture, confidence, minIntervalMs = 40, model = 'full' } = {}) {
    this.modelPath = MODELS[model] ?? MODELS.full;
    this.onStatus = onStatus ?? (() => {});
    /**
     * Floor on the gap between inferences, in milliseconds.
     *
     * Steering is what this rig is for, and the two models share one GPU.
     * Measured with both running flat out, the hand tracker fell from about
     * 30 fps to 19 — the pose model costs 22 ms a frame and was taking every
     * frame the camera offered. Running the feet at ~20 Hz instead gives that
     * back, and costs nothing anyone can feel: a pedal travels in a tenth of
     * a second, not a sixtieth.
     */
    this.minIntervalMs = minIntervalMs;
    this._lastDetect = 0;
    // Low on purpose. A foot camera sees a fraction of a person, so the
    // detector is never confident — hold it to the confidence you would want
    // from a full-body shot and it simply never fires. What a loose threshold
    // lets through is filtered afterwards by landmark visibility, which is
    // the honest measure of whether a foot was actually seen.
    this.confidence = { detect: 0.2, presence: 0.2, track: 0.2, ...confidence };
    this.landmarker = null;

    /** @type {{left: object|null, right: object|null, at: number, captureAt: number} | null} */
    this.latest = null;
    this.inferenceMs = 0;

    this.camera = new CameraCapture({
      // Feet are slow and close to the floor. 30fps at a 640px working frame
      // is plenty for pedal travel and leaves the hand model its headroom.
      capture: { wide: true, height: 720, frameRate: 30, work: 640, ...capture },
      onStatus: this.onStatus,
      // Decline the frame outright rather than dropping it after it has been
      // scaled: the veto is what actually saves the work.
      shouldProcess: (now) => now - this._lastDetect >= this.minIntervalMs,
      onFrame: (source, stamp, captureAt) => this._detect(source, stamp, captureAt),
    });
  }

  get running() { return this.camera.running; }
  get video() { return this.camera.video; }
  get settings() { return this.camera.settings; }
  get fps() { return this.camera.fps; }
  get captureFps() { return this.camera.captureFps; }

  get ready() { return this.running && this.latest !== null; }

  async load() {
    if (this.landmarker) return;
    this.onStatus({ state: 'loading', message: 'loading pose model…' });
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.modelPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: this.confidence.detect,
      minPosePresenceConfidence: this.confidence.presence,
      minTrackingConfidence: this.confidence.track,
      outputSegmentationMasks: false,
    });
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {string} [deviceId]
   */
  async start(video, deviceId) {
    if (this.running) return;
    await this.load();
    this.onStatus({ state: 'opening', message: 'opening foot camera…' });
    await this.camera.open(video, deviceId);
    this.onStatus({ state: 'searching', message: 'looking for your feet…' });
  }

  stop() {
    this.camera.stop();
    this.latest = null;
    this.onStatus({ state: 'off', message: 'foot camera off' });
  }

  _detect(source, stamp, captureAt) {
    const began = performance.now();
    this._lastDetect = began;
    const result = this.landmarker.detectForVideo(source, stamp);
    this.inferenceMs += (performance.now() - began - this.inferenceMs) * 0.1;

    const lm = result?.landmarks?.[0] ?? null;
    /** Whether a person was found at all, as opposed to found without feet. */
    this.sawPerson = !!lm;
    this.latest = {
      left: lm ? footMetrics(lm, 'left') : null,
      right: lm ? footMetrics(lm, 'right') : null,
      landmarks: lm,
      at: performance.now(),
      captureAt,
    };
  }
}
