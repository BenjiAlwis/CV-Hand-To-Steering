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
import { handBox, footBox, boxClipped, visibleFraction } from '../vision/boxes.js';

/**
 * Draws one bounding box, labelled.
 *
 * The box is drawn inside the mirrored frame so it sits on what it describes,
 * but the label is drawn back the right way round — mirrored text is not
 * readable, and a label nobody can read is worse than no label.
 *
 * A box that runs off the picture is dashed rather than solid, because the
 * two cases mean different things: a solid box is the whole hand, a dashed
 * one is as much of it as the camera can see.
 */
function drawBox(c, box, { colour, label, W, offsetX, offsetY, dw, dh }) {
  if (!box) return;
  const x = offsetX + box.x0 * dw, y = offsetY + box.y0 * dh;
  const w = box.width * dw, h = box.height * dh;
  const cut = boxClipped(box);

  c.save();
  c.strokeStyle = colour;
  c.lineWidth = 1.75;
  c.setLineDash(cut ? [5, 4] : []);
  c.globalAlpha = 0.95;
  c.strokeRect(x, y, w, h);
  c.restore();

  c.save();
  c.translate(W, 0);
  c.scale(-1, 1);                       // back out of the mirror, for the text
  c.fillStyle = colour;
  c.font = '600 9px ui-monospace, monospace';
  c.globalAlpha = 0.95;
  // Kept inside the panel. A box against the edge of frame is exactly the
  // case worth reading — it is the one whose label says how much of the hand
  // is still visible — and it is also the one whose label would fall off.
  const textWidth = c.measureText(label).width;
  const lx = Math.max(2, Math.min(W - x - w, W - textWidth - 2));
  c.fillText(label, lx, Math.max(9, y - 3));
  c.restore();
}

export class CameraPanel {
  constructor({ onToggle, onRecalibrate, onRatio, onZeroPedals }) {
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

    /* the foot half */
    this.footRoot = document.getElementById('footPanel');
    this.footCanvas = document.getElementById('footCanvas');
    this.footCtx = this.footCanvas.getContext('2d');
    this.footStatusEl = document.getElementById('footStatus');
    this.footHintEl = document.getElementById('footHint');
    this.footPipeEl = document.getElementById('footPipeline');
    this.pedalBars = {
      throttle: document.getElementById('pedalThrottle'),
      brake: document.getElementById('pedalBrake'),
    };
    this.pedalValues = {
      throttle: document.getElementById('pedalThrottleValue'),
      brake: document.getElementById('pedalBrakeValue'),
    };
    document.getElementById('pedalZero').addEventListener('click', () => onZeroPedals?.());

    this.enabled = false;
    this.sticky = false;
    this.footSticky = false;
  }

  setFootStatus(message, state = 'idle') {
    const tone = state === 'error' ? 'error'
      : state === 'loading' || state === 'opening' ? 'busy'
      : state === 'off' ? 'idle' : 'live';
    this.footStatusEl.textContent = message;
    this.footStatusEl.dataset.tone = tone;
    this.footSticky = tone === 'error' || tone === 'busy';
  }

  /**
   * The pedal half of the panel: the foot camera's view, the two ankles and
   * feet the pose model found, and how far each pedal is being pressed.
   *
   * Seeing the skeleton matters as much here as it does for hands — a pedal
   * that will not move is almost always a foot the model cannot see, and
   * that is obvious the moment you can watch it being tracked.
   */
  drawFeet(video, tracker, pedals, advice) {
    const live = !!tracker?.running;
    this.footRoot.classList.toggle('live', live);

    for (const which of ['throttle', 'brake']) {
      const v = pedals?.state?.[which]?.value ?? 0;
      this.pedalBars[which].style.width = `${Math.round(v * 100)}%`;
      this.pedalBars[which].classList.toggle('pressed', v > 0.02);
      this.pedalValues[which].textContent = `${Math.round(v * 100)}%`;
    }

    const ctx = this.footCtx;
    const { width: w, height: h } = this.footCanvas;
    ctx.clearRect(0, 0, w, h);
    if (!live || !video || video.readyState < 2) {
      if (!this.footSticky) this.setFootStatus(live ? 'looking for your feet…' : 'no foot camera', live ? 'live' : 'idle');
      return;
    }

    // Mirrored to read like a mirror, exactly as the hand feed is. The maths
    // behind it runs on the raw frame; only this preview is flipped.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    ctx.globalAlpha = 0.78;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;

    const feet = tracker.latest;
    for (const [side, tone] of [['right', '#2fe07a'], ['left', '#ff6a3d']]) {
      const foot = feet?.[side];
      if (!foot) continue;
      const faded = foot.visibility < 0.55;

      if (this.boxes) {
        const box = footBox(foot);
        ctx.globalAlpha = faded ? 0.45 : 1;
        drawBox(ctx, box, {
          colour: tone, W: w, offsetX: 0, offsetY: 0, dw: w, dh: h,
          // The model's own confidence, since a foot it is unsure about is
          // the commonest reason a pedal will not move.
          label: `${side} ${Math.round(foot.visibility * 100)}%` +
            (boxClipped(box) ? ' · cut off' : ''),
        });
      }

      ctx.globalAlpha = faded ? 0.3 : 1;
      ctx.strokeStyle = tone;
      ctx.fillStyle = tone;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(foot.ankle.x * w, foot.ankle.y * h);
      ctx.lineTo(foot.heel.x * w, foot.heel.y * h);
      ctx.lineTo(foot.toe.x * w, foot.toe.y * h);
      ctx.stroke();
      for (const pt of [foot.ankle, foot.heel, foot.toe]) {
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Say which of the two failures this is. "Looking for your feet" covers
    // both "there is nobody in this picture" and "I can see you but your feet
    // are not in the frame", and they need opposite things done about them —
    // so the panel reports the model's own confidence in each foot rather
    // than hiding it behind one message.
    if (!this.footSticky) {
      const t = pedals?.state?.throttle, br = pedals?.state?.brake;
      const n = [t?.seen, br?.seen].filter(Boolean).length;
      const best = Math.max(t?.visibility ?? 0, br?.visibility ?? 0);
      this.setFootStatus(
        n === 2 ? 'both feet tracking'
          : n === 1 ? 'one foot tracking'
            : !tracker.sawPerson ? 'nobody in the foot camera'
              : `feet not clear enough (${Math.round(best * 100)}%)`,
        n ? 'live' : 'busy',
      );
    }
    // The hint is where the framing gets coached, because a pedal that will
    // not move is nearly always a camera in the wrong place rather than a
    // driver doing the wrong thing.
    const th = pedals?.state?.throttle, br = pedals?.state?.brake;
    this.footHintEl.textContent = advice?.ok
      ? `heels down, pivot at the ankle · R ${Math.round((th?.visibility ?? 0) * 100)}% L ${Math.round((br?.visibility ?? 0) * 100)}%`
      : advice?.message ?? 'right foot throttle, left foot brake';
    this.footHintEl.classList.toggle('coaching', !!advice && !advice.ok);
    if (tracker.settings) {
      this.footPipeEl.textContent =
        `${tracker.settings.width}×${tracker.settings.height} · ${tracker.fps}fps · ${tracker.inferenceMs.toFixed(0)}ms`;
    }
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
  /** Whether to outline what the trackers found. Off unless asked for. */
  setBoxes(on) { this.boxes = !!on; }

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

      if (this.boxes) {
        const box = handBox(hand);
        const seen = visibleFraction(box);
        drawBox(c, box, {
          colour, W,
          offsetX: (W - dw) / 2, offsetY: (H - dh) / 2, dw, dh,
          label: `${hand.handedness?.toLowerCase() ?? 'hand'} ${Math.round(hand.grip * 100)}%` +
            (boxClipped(box) ? ` · ${Math.round(seen * 100)}% in shot` : ''),
        });
      }
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
