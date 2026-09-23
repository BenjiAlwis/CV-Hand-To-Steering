/**
 * Camera hand tracking.
 *
 * Wraps MediaPipe's HandLandmarker: opens the camera, runs detection on video
 * frames, and publishes the most recent result. It knows nothing about
 * steering — that lives in `input/handsource.js` — so this file stays a thin
 * boundary around the model.
 *
 * Both the WASM runtime and the model are served from the project, so the
 * tracker starts with no network connection.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { handMetrics } from './handmath.js';

const WASM_PATH = '/node_modules/@mediapipe/tasks-vision/wasm';
const MODEL_PATH = '/assets/models/hand_landmarker.task';

export class HandTracker {
  constructor({ onStatus, exposure = 'auto', capture, confidence } = {}) {
    this.onStatus = onStatus ?? (() => {});
    this.exposure = exposure;
    /**
     * Capture and inference are deliberately separate settings.
     *
     * Asking for a particular *shape* of frame is what quietly costs field of
     * view: plenty of sensors are 4:3 and make 16:9 by cropping the top and
     * bottom away, so hands leave tracking sooner than they need to. `wide`
     * asks for a height and leaves the width and aspect to the camera, which
     * then hands back its own native shape.
     *
     * Note what this is *not*: demanding the largest mode on offer. That does
     * give the full sensor, but the largest mode is usually also the slowest —
     * measured, it produced 3840×2160 at 10 fps with 47 ms inference, which
     * trades away exactly the frame rate fast movement depends on. Resolution
     * is not what widens the view; shape is.
     *
     * The frame is then scaled to `work` for the model, so inference costs
     * what we choose regardless of what the camera sends.
     */
    this.capture = { wide: true, height: 720, frameRate: 60, work: 960, ...capture };

    /** How willing the model is to accept a hand it is unsure about. */
    this.confidence = { detect: 0.35, presence: 0.35, track: 0.30, ...confidence };
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;

    /** @type {{hands: Array, at: number, captureAt: number} | null} */
    this.latest = null;

    /** Frames actually put through the model, per second. */
    this.fps = 0;
    /** Frames the camera delivered, per second — may be higher than `fps`. */
    this.captureFps = 0;
    /** How long the model takes on one frame, in milliseconds. */
    this.inferenceMs = 0;
    /** What the camera actually gave us, once it is open. */
    this.settings = null;

    /** Downscaled copy of the frame that the model actually sees. */
    this._work = null;
    this._workCtx = null;
    this.workSize = null;

    this._busy = false;
    this._frames = 0;
    this._captured = 0;
    this._fpsAt = 0;
    this._lastStamp = 0;
  }

  get ready() {
    return this.running && this.latest !== null;
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
   * @param {HTMLVideoElement} video the element to stream into
   */
  async start(video) {
    if (this.running) return;
    this.video = video;

    await this.load();

    this.onStatus({ state: 'opening', message: 'opening camera…' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Every one of these is `ideal`, never `min` or `exact`. A hard
          // constraint a camera cannot meet fails the whole request rather
          // than settling for something close.
          // No width and no aspect ratio when going wide: naming either one
          // invites the driver to crop the sensor to match it.
          ...(this.capture.wide ? {} : { width: { ideal: this.capture.width } }),
          height: { ideal: this.capture.height },
          // Do not let the browser crop and scale to hit a target shape;
          // cropping is exactly the field of view we are trying to keep.
          resizeMode: 'none',
          // Frame rate is what lets fast movement be seen at all. It also
          // shortens exposure as a side effect — a camera cannot expose for
          // 33 ms and still deliver 60 frames a second — which is the real
          // cure for the motion blur that makes a moving hand undetectable.
          frameRate: { ideal: this.capture.frameRate },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (error) {
      this.onStatus({ state: 'error', message: cameraError(error) });
      throw error;
    }

    await this._tuneTrack();

    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    this.running = true;
    this._fpsAt = performance.now();
    this._lastStamp = 0;
    this.onStatus({ state: 'searching', message: 'looking for your hands…' });
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._rvfc && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this._rvfc);
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.latest = null;
    this.settings = null;
    this.onStatus({ state: 'off', message: 'camera off' });
  }

  /** Asks the camera for the behaviour that suits fast hands and a wide view. */
  async _tuneTrack() {
    const [track] = this.stream?.getVideoTracks() ?? [];
    if (!track) return;

    let caps = {};
    try { caps = track.getCapabilities?.() ?? {}; } catch { /* not supported */ }

    // Some cameras — and macOS Centre Stage — start zoomed in, which narrows
    // the view before we have even seen a frame.
    if (this.capture.wide && caps.zoom?.min !== undefined) {
      try {
        await track.applyConstraints({ zoom: caps.zoom.min });
      } catch { /* the camera kept its own zoom */ }
    }

    // Tells the pipeline this is motion, not detail — the opposite trade to a
    // slide or a document.
    try { track.contentHint = 'motion'; } catch { /* not supported everywhere */ }

    // Shortening exposure is the most direct cure for motion blur, but it is
    // off by default on purpose: too short in a dim room and the model cannot
    // see the hands at all, which is worse than blur. Opt in with
    // `new HandTracker({ exposure: 'short' })`.
    if (this.exposure === 'short') {
      try {
        const caps = track.getCapabilities?.() ?? {};
        if (caps.exposureTime && caps.exposureMode?.includes('manual')) {
          const { min, max, step = 1 } = caps.exposureTime;
          // A quarter of the way up the range: shorter than the camera would
          // choose, without diving to the darkest setting it can do.
          const target = Math.round((min + (max - min) * 0.25) / step) * step;
          track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: target }] })
            .catch(() => { /* the camera kept its own setting */ });
        }
      } catch { /* capability queries are not universally supported */ }
    }

    this.settings = track.getSettings?.() ?? null;
  }

  /**
   * Asks to be called again for the next frame.
   *
   * `requestVideoFrameCallback` fires once per decoded camera frame, which is
   * what this actually wants. Driving detection from `requestAnimationFrame`
   * instead ties it to the display's refresh rather than the camera's output:
   * the two are never quite in step, so some camera frames get processed twice
   * and others are skipped entirely — exactly the frames a fast movement
   * needs. It also hands over a capture timestamp, so velocity is measured
   * against when the frame was taken rather than when the model finished with
   * it, which jitters.
   */
  _schedule() {
    if (!this.running) return;
    const video = this.video;
    if (video?.requestVideoFrameCallback) {
      this._rvfc = video.requestVideoFrameCallback(this._onFrame);
    } else {
      this._raf = requestAnimationFrame(() => this._onFrame(performance.now(), null));
    }
  }

  _onFrame = (now, metadata) => {
    if (!this.running) return;

    this._captured++;

    // Skip rather than queue. If the model is still working, the honest thing
    // is to drop this frame and take the next one — falling behind by a
    // growing backlog would show up as the wheel lagging further and further.
    if (this._busy) {
      this._schedule();
      return;
    }

    const video = this.video;
    if (!video || video.readyState < 2) {
      this._schedule();
      return;
    }

    // When the frame was taken, as close as the browser will say. Falls back
    // through presentation time to the callback time.
    const captureAt = metadata?.captureTime ?? metadata?.presentationTime ?? now;

    // Scale the frame down for the model. Aspect is preserved, so the
    // landmarks come back in the same normalised space as the full frame and
    // nothing downstream has to know this happened.
    const source = this._workFrame(video);

    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const stamp = Math.max(this._lastStamp + 0.001, captureAt);
    this._lastStamp = stamp;

    this._busy = true;
    const began = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(source, stamp);
    } catch {
      this._busy = false;
      this._schedule();
      return;
    }
    const took = performance.now() - began;
    this._busy = false;

    const hands = (result?.landmarks ?? []).map((landmarks, i) => ({
      landmarks,
      handedness: result.handedness?.[i]?.[0]?.categoryName ?? null,
      ...handMetrics(landmarks),
    }));

    this.latest = { hands, at: performance.now(), captureAt };

    this._frames++;
    this.inferenceMs += (took - this.inferenceMs) * 0.1;
    const since = performance.now() - this._fpsAt;
    if (since > 500) {
      this.fps = Math.round((this._frames * 1000) / since);
      this.captureFps = Math.round((this._captured * 1000) / since);
      this._frames = 0;
      this._captured = 0;
      this._fpsAt = performance.now();
    }

    this._schedule();
  };
}

/**
 * Returns the frame to run detection on: the video itself if it is already at
 * or below the working size, otherwise a scaled-down copy.
 */
HandTracker.prototype._workFrame = function _workFrame(video) {
  const longest = Math.max(video.videoWidth, video.videoHeight);
  const target = this.capture.work;
  if (!target || longest <= target) return video;

  const scale = target / longest;
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);

  if (!this._work || this._work.width !== w || this._work.height !== h) {
    this._work = document.createElement('canvas');
    this._work.width = w;
    this._work.height = h;
    this._workCtx = this._work.getContext('2d', { alpha: false, willReadFrequently: false });
    this.workSize = { width: w, height: h };
  }
  this._workCtx.drawImage(video, 0, 0, w, h);
  return this._work;
};

function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
      return 'camera permission denied — allow it in System Settings › Privacy & Security › Camera';
    case 'NotFoundError':
      return 'no camera found';
    case 'NotReadableError':
      return 'camera is in use by another app';
    case 'OverconstrainedError':
      return `camera cannot meet the requested ${error.constraint ?? 'settings'}`;
    default:
      return `camera failed: ${error?.message || error?.name || 'unknown error'}`;
  }
}
