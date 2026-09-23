/**
 * Camera panel.
 *
 * Shows the tracker what it sees: the feed, the landmarks it found, and how
 * closed each hand is. Without this, a grip that will not engage is a
 * mystery — with it you can see immediately whether the hand is out of frame,
 * half open, or simply not being found.
 *
 * The feed is drawn mirrored so it reads like a mirror, but the maths behind
 * it runs on the raw frame; only this preview is flipped.
 */
export class CameraPanel {
  constructor({ onToggle, onRecalibrate, onRatio }) {
    this.root = document.getElementById('camera');
    this.canvas = document.getElementById('cameraCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = document.getElementById('cameraStatus');
    this.button = document.getElementById('cameraToggle');
    this.gripBars = [document.getElementById('gripL'), document.getElementById('gripR')];
    this.hintEl = document.getElementById('cameraHint');
    this.handEl = document.getElementById('handAngle');
    this.wheelEl = document.getElementById('wheelAngle');
    this.ratioEl = document.getElementById('ratioValue');
    this.trackEl = document.getElementById('handNeedle');
    this.pipeEl = document.getElementById('cameraPipeline');
    this.flapBars = [document.getElementById('flapL'), document.getElementById('flapR')];

    document.getElementById('ratioDown').addEventListener('click', () => onRatio(-0.25));
    document.getElementById('ratioUp').addEventListener('click', () => onRatio(0.25));

    this.button.addEventListener('click', () => onToggle());
    document.getElementById('cameraZero').addEventListener('click', () => onRecalibrate());

    this.enabled = false;
    this.sticky = false;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.sticky = false;
    this.root.classList.toggle('live', on);
    this.button.textContent = on ? 'Stop camera' : 'Start camera';
  }

  /**
   * Status from the tracker's lifecycle (loading, opening, failed). These
   * latch: an error must not be scrolled away by the per-frame updates.
   */
  setStatus(message, tone = 'idle') {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.sticky = tone === 'error' || tone === 'busy';
  }

  /**
   * The correlation readout: how far your hands have turned, how far the
   * wheel has turned, and the ratio between them. Seeing both numbers is the
   * quickest way to tell a tracking problem from a ratio you dislike.
   */
  _correlation(source) {
    const deg = (r) => (r * 180) / Math.PI;
    const hand = source.state.holding ? deg(source.state.handAngle) : 0;
    const wheel = source.state.holding ? deg(source.state.wheelAngle) : 0;
    this.handEl.textContent = `${hand >= 0 ? '+' : '−'}${Math.abs(hand).toFixed(0)}°`;
    this.wheelEl.textContent = `${wheel >= 0 ? '+' : '−'}${Math.abs(wheel).toFixed(0)}°`;
    this.ratioEl.textContent = `${source.ratio.toFixed(2)}×`;
    this.trackEl.style.transform = `translateX(-50%) rotate(${hand}deg)`;
  }

  /**
   * What the camera and the model are actually managing, as opposed to what
   * was asked for. Fast movement lives or dies on these numbers, and a camera
   * quietly delivering 30 fps when 60 was requested is invisible otherwise.
   */
  _pipeline(tracker) {
    if (!this.pipeEl) return;
    const s = tracker.settings;
    if (!s) { this.pipeEl.textContent = ''; return; }
    const dropped = tracker.captureFps > tracker.fps + 2
      ? ` · ${tracker.captureFps - tracker.fps} dropped` : '';
    const work = tracker.workSize
      ? ` → ${tracker.workSize.width}×${tracker.workSize.height}` : '';
    this.pipeEl.textContent =
      `${s.width}×${s.height}${work} · camera ${tracker.captureFps}fps · model ` +
      `${tracker.fps}fps (${tracker.inferenceMs.toFixed(0)}ms)${dropped}`;
  }

  /** Per-frame status: what the tracker can actually see right now. */
  _liveStatus(tracker, source) {
    if (this.sticky || !this.enabled) return;
    const hands = tracker.latest?.hands?.length ?? 0;

    // Coasting is its own state: the wheel is still being held even though
    // the hands are not currently visible.
    if (source.state.coasting) {
      this.statusEl.textContent = 'holding through a dropout…';
      this.statusEl.dataset.tone = 'busy';
      return;
    }

    const text = source.state.single ? `one hand · ${tracker.fps} Hz`
      : hands === 0 ? 'no hands in frame'
      : hands === 1 ? 'one hand — show both'
      : source.state.holding ? `holding · ${tracker.fps} Hz`
      : `tracking both hands · ${tracker.fps} Hz`;
    this.statusEl.textContent = text;
    this._pipeline(tracker);
    this.statusEl.dataset.tone = source.state.single ? 'busy'
      : source.state.holding ? 'live' : 'idle';
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {import('../vision/handtracker.js').HandTracker} tracker
   * @param {import('../input/handsource.js').HandTrackingSource} source
   */
  draw(video, tracker, source, shifter) {
    const c = this.ctx;
    const { width: W, height: H } = this.canvas;

    if (!this.enabled || !video || video.readyState < 2) {
      c.fillStyle = '#080a0e';
      c.fillRect(0, 0, W, H);
      for (const bar of this.gripBars) { bar.style.width = '0%'; bar.classList.remove('held'); }
      return;
    }

    c.save();
    c.translate(W, 0);
    c.scale(-1, 1);                       // mirror, so it reads like a mirror
    // Cover-fit the frame into the panel without distorting it.
    const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    c.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);

    const hands = tracker.latest?.hands ?? [];
    const holding = source.state.holding;

    for (const hand of hands) {
      const px = (p) => ({ x: (W - dw) / 2 + p.x * dw, y: (H - dh) / 2 + p.y * dh });
      const held = hand.grip > 0.5;
      const colour = held ? '#2fe07a' : '#ffb545';

      c.strokeStyle = colour;
      c.lineWidth = 2;
      c.globalAlpha = 0.9;
      for (const bone of BONES) {
        const a = px(hand.landmarks[bone[0]]), b = px(hand.landmarks[bone[1]]);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
      c.fillStyle = colour;
      for (const p of hand.landmarks) {
        const q = px(p);
        c.beginPath(); c.arc(q.x, q.y, 2.6, 0, Math.PI * 2); c.fill();
      }

      const anchor = px(hand.anchor);
      c.beginPath(); c.arc(anchor.x, anchor.y, 7, 0, Math.PI * 2);
      c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.stroke();
    }

    // The line the steering angle is actually read from.
    if (hands.length === 2) {
      const px = (p) => ({ x: (W - dw) / 2 + p.x * dw, y: (H - dh) / 2 + p.y * dh });
      const a = px(hands[0].anchor), b = px(hands[1].anchor);
      c.setLineDash(holding ? [] : [5, 5]);
      c.strokeStyle = holding ? '#4dd4ff' : 'rgba(150,170,200,.5)';
      c.lineWidth = holding ? 3 : 2;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
    c.globalAlpha = 1;

    this.root.classList.toggle('coasting', source.state.coasting);

    // Finger extension on each hand, scaled so a pull fills the bar.
    if (shifter) {
      const span = (v) => Math.round(Math.max(0, Math.min(1, (v - 1.15) / 0.62)) * 100);
      this.flapBars[0].style.width = `${span(shifter.state.left)}%`;
      this.flapBars[1].style.width = `${span(shifter.state.right)}%`;
      this.flapBars[0].classList.toggle('pulled', shifter.state.left > 1.72);
      this.flapBars[1].classList.toggle('pulled', shifter.state.right > 1.72);
    }

    const [gl, gr] = source.state.grips;
    this.gripBars[0].style.width = `${Math.round((gl ?? 0) * 100)}%`;
    this.gripBars[1].style.width = `${Math.round((gr ?? 0) * 100)}%`;
    for (const bar of this.gripBars) bar.classList.toggle('held', holding);

    this.hintEl.textContent = source.state.reason;
    this._liveStatus(tracker, source);
    this._correlation(source);
  }
}

/** MediaPipe's 21-point hand skeleton. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
