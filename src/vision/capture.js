/**
 * Opening a camera and getting frames out of it.
 *
 * Both trackers need the same things — a stream that keeps its field of view,
 * frames delivered as the camera produces them, and a downscaled copy for the
 * model — and none of that is specific to hands or to feet. It lives here so
 * there is one copy of it to get right.
 *
 * What it does not know is what to do with a frame. The consumer passes
 * `onFrame` and runs its own model there, synchronously; this class handles
 * everything around that call.
 */
export class CameraCapture {
  /**
   * @param {object}   options
   * @param {function} options.onFrame   (source, stamp, captureAt) => void
   * @param {function} [options.onStatus]
   * @param {object}   [options.capture]
   * @param {string}   [options.exposure]
   */
  constructor({ onFrame, onStatus, shouldProcess, capture, exposure = 'auto' } = {}) {
    this.onFrame = onFrame ?? (() => {});
    /**
     * Optional veto, asked before any work is done on a frame.
     *
     * A consumer that only wants every third frame must be able to say so
     * *here*, because the scaled-down copy the model reads is built before
     * `onFrame` is called — deciding to skip inside it still pays for the
     * downscale, thirty times a second, for a frame nobody looks at.
     */
    this.shouldProcess = shouldProcess ?? null;
    this.onStatus = onStatus ?? (() => {});
    this.exposure = exposure;

    /**
     * Capture and inference are deliberately separate settings.
     *
     * Asking for a particular *shape* of frame is what quietly costs field of
     * view: plenty of sensors are 4:3 and make 16:9 by cropping the top and
     * bottom away, so a hand or a foot leaves tracking sooner than it needs
     * to. `wide` asks for a height and leaves the width and aspect to the
     * camera, which then hands back its own native shape.
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

    this.video = null;
    this.stream = null;
    this.running = false;
    this.deviceId = null;

    /** Frames actually put through the model, per second. */
    this.fps = 0;
    /** Frames the camera delivered, per second — may be higher than `fps`. */
    this.captureFps = 0;
    /** What the camera actually gave us, once it is open. */
    this.settings = null;

    this._work = null;
    this._workCtx = null;
    this.workSize = null;

    this.busy = false;
    this._frames = 0;
    this._captured = 0;
    this._fpsAt = 0;
    this._lastStamp = 0;
  }

  /**
   * Opens the camera and starts delivering frames.
   *
   * @param {HTMLVideoElement} video     the element to stream into
   * @param {string} [deviceId]          a specific camera, or the default one
   */
  async open(video, deviceId) {
    if (this.running) return;
    this.video = video;
    this.deviceId = deviceId ?? null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Every one of these is `ideal`, never `min` or `exact` — except the
          // device, which must be exact or the browser is free to hand back
          // the other camera and quietly point both trackers at one lens.
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
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
    this.settings = null;
  }

  /** Asks the camera for the behaviour that suits fast movement and a wide view. */
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
    // see anything at all, which is worse than blur.
    if (this.exposure === 'short') {
      try {
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
    if (this.busy) {
      this._schedule();
      return;
    }

    const video = this.video;
    if (!video || video.readyState < 2) {
      this._schedule();
      return;
    }

    if (this.shouldProcess && !this.shouldProcess(now)) {
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

    this.busy = true;
    const began = performance.now();
    try {
      this.onFrame(source, stamp, captureAt);
    } catch {
      /* one bad frame is not worth stopping the camera for */
    }
    this.lastCostMs = performance.now() - began;
    this.busy = false;

    this._frames++;
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

  /**
   * Returns the frame to run detection on: the video itself if it is already
   * at or below the working size, otherwise a scaled-down copy.
   */
  _workFrame(video) {
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
  }
}

export function cameraError(error) {
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
