/**
 * Steering from the camera.
 *
 * The wheel **matches** your hands. The line between your knuckles is measured
 * against horizontal, and that angle is the wheel's angle — hands level means
 * the wheel is centred, hands at 40° means the wheel is at 40°. Exactly like
 * holding a real wheel, where its position is simply wherever your hands have
 * put it.
 *
 *  · Both hands closed  → you are holding the wheel, and it tracks you.
 *  · Either hand opens  → you have let go. The controller's spring returns it
 *    to centre, just as it does when you release a mouse drag.
 *
 * This is deliberately an *absolute* mapping, not a relative one. Treating
 * wherever you happened to grip as straight-ahead and measuring change from
 * there seems reasonable until your hands leave the frame: on the way back in
 * they are rarely level, that tilted pose silently becomes the new zero, and
 * the wheel ignores a hand angle it is staring straight at. Measuring against
 * horizontal has no hidden state to go stale, so hands returning at any angle
 * are matched on the first frame they are seen.
 *
 * `trim` exists for driver preference, not for zeroing on every grip — if you
 * naturally hold your hands a few degrees off level, re-zero once and that
 * offset sticks.
 *
 * Four things keep the measurement honest:
 *
 *  1. The hands are paired by identity, not re-sorted by screen position, so
 *     the measurement survives them crossing over past a quarter turn, and
 *     the thumbs — not a left/right label — decide which way up that pair is
 *     read.
 *  2. The angle is unwrapped for continuity while you hold, and re-anchored to
 *     absolute horizontal whenever the hands are re-acquired.
 *  3. A One-Euro filter smooths a still hand hard and a moving one barely, so
 *     there is no constant lag to fight.
 *  4. The default ratio is 1:1 — the wheel sits exactly where your hands are.
 */
import { SteeringSource } from './source.js';
import {
  pairedAngle, orientPair, handRoll, handSpan, angleDelta,
  GripLatch, AngleUnwrapper, OneEuroFilter, HandPairTracker, clamp,
} from '../vision/handmath.js';

export class HandTrackingSource extends SteeringSource {
  /**
   * @param {import('../vision/handtracker.js').HandTracker} tracker
   */
  constructor(tracker, {
    priority = 20,
    /** Wheel degrees per degree of arm rotation. 1 means the wheel matches you. */
    ratio = 1,
    lock = Math.PI * 0.75,
    /** Hands closer together than this are too unreliable to steer with. */
    minSpan = 1.6,
    /** A result older than this is treated as no result at all. */
    staleMs = 220,
    /**
     * A gap in good measurements longer than this re-anchors the angle
     * instead of continuing from the accumulated one.
     *
     * The unwrapped angle is only trustworthy while it is being fed every
     * frame. Carry it across a gap — a detector that stalled, hands that left
     * the frame, a grip that opened — and it silently describes a position
     * the hands are no longer in. Because the mapping is absolute, throwing it
     * away costs nothing: the next frame re-reads the angle from horizontal.
     */
    reanchorMs = 200,
    /**
     * Fastest believable arm rotation, radians per second.
     *
     * Generous on purpose. A hard correction reaches 700°/s and a flick more
     * than that, so a limit anywhere near human speed rejects real driving —
     * measured, a 12 rad/s limit started discarding frames at 688°/s and the
     * wheel simply stopped following. What this needs to catch is a pairing
     * flip, which moves half a turn in a single frame: 190 rad/s at 60 Hz.
     */
    maxRate = 35,
    /**
     * How long to keep hold of the wheel when the hands vanish.
     *
     * The detector drops a hand for a frame or two routinely, and a hand
     * genuinely leaving the edge of frame for a moment is normal driving.
     * Throwing the grip and the zero reference away on the first missing
     * frame means a hand that comes back tilted is read as straight-ahead,
     * so the tilt does nothing at all.
     */
    graceMs = 700,
  } = {}) {
    super('hands', priority);
    this.tracker = tracker;
    this.ratio = ratio;
    this.lock = lock;
    this.minSpan = minSpan;
    this.staleMs = staleMs;
    this.reanchorMs = reanchorMs;
    this.maxRate = maxRate;
    this.graceMs = graceMs;

    this.latches = [new GripLatch(), new GripLatch()];
    this.pairs = new HandPairTracker();
    this.unwrapper = new AngleUnwrapper();
    this.filter = new OneEuroFilter({ minCutoff: 0.8, beta: 1.2 });

    /**
     * Driver trim: a fixed offset subtracted from the measured hand angle, so
     * someone who rests their hands a few degrees off level can still centre
     * the wheel. Zero means horizontal hands centre it.
     */
    this.trim = 0;
    this._trimNext = false;
    /** The two hands, named, once a grip is being read. */
    this.hands = null;
    /**
     * How each hand's own roll relates to the angle the pair reports.
     *
     * Learned continuously while both hands are visible, so that if one
     * leaves the frame the other carries on from exactly where the pair left
     * off, rather than jumping by however far that hand happens to be rolled
     * relative to the wheel.
     */
    this._rollOffset = { right: null, left: null };
    this._rightSlot = 0;
    this.angle = 0;
    this._lastAt = null;
    this._lastHand = 0;
    this._lostAt = null;
    this._rejected = 0;
    this._velocity = 0;
    this._velAt = null;
    this._velLast = 0;
    /**
     * When the last good measurement was taken, in seconds. Any gap longer
     * than `reanchorMs` means the continuity we were relying on is no longer
     * trustworthy and the angle must be read afresh from horizontal.
     */
    this._measuredAt = null;

    /** Exposed for the overlay. */
    this.state = {
      holding: false, coasting: false, single: false, hands: 0, grips: [0, 0], span: 0,
      handAngle: 0, wheelAngle: 0, reason: 'camera off',
    };
  }

  /**
   * Takes the driver's current hand angle as level.
   *
   * A one-off preference, not something that happens on every grip — the
   * offset persists until it is set again.
   */
  recalibrate() {
    this._trimNext = true;
    this.filter.reset();
    this._lastAt = null;
  }

  /** Changes how far the wheel turns per degree of arm rotation, live. */
  setRatio(ratio) {
    this.ratio = clamp(ratio, 0.5, 3);
    return { ratio: this.ratio };
  }

  sync() {
    // Nothing to do: the mapping is absolute, so there is no accumulated
    // reference that could drift out of step with the wheel.
  }

  disconnect() {
    this.tracker.stop();
  }

  read() {
    const snapshot = this.tracker.latest;
    const fresh = snapshot && performance.now() - snapshot.at < this.staleMs;

    if (!this.enabled || !this.tracker.running) {
      this._lose();
      return this._idle('camera off');
    }

    if (!fresh) {
      // Frames have stopped. Hold briefly, then let go — and crucially drop
      // the accumulated angle, so whenever they resume the reading is taken
      // fresh rather than continued from a stale one.
      const nowSec = performance.now() / 1000;
      if (this.state.holding && this._measuredAt !== null) {
        this._lostAt ??= nowSec;
        if (nowSec - this._lostAt <= this.graceMs / 1000) {
          return this._coast(nowSec, 'waiting for frames');
        }
      }
      this._lose();
      return this._idle('waiting for frames');
    }

    const hands = snapshot.hands;
    // Time the measurement from when the frame was *taken*, not when the model
    // finished with it. Inference time varies frame to frame, and letting that
    // jitter into dt puts the same jitter straight into the velocity estimate
    // the controller leads on.
    const now = (snapshot.captureAt ?? snapshot.at) / 1000;
    this.state.hands = hands.length;

    // Pair by identity rather than by screen position, so the two hands stay
    // in the same slots when they cross over.
    const pair = this.pairs.update(hands);

    /** The wheel angle this frame, wrapped, however it was arrived at. */
    let raw = null;
    let firmness = 0;
    let single = false;

    if (pair) {
      const [driverRight, driverLeft] = orientPair(pair[0], pair[1]);
      this.hands = { right: driverRight, left: driverLeft };
      this._rightSlot = driverRight === pair[0] ? 0 : 1;

      const gripR = this.latches[0].update(driverRight.grip);
      const gripL = this.latches[1].update(driverLeft.grip);
      this.state.grips = [driverRight.grip, driverLeft.grip];

      const span = handSpan(driverRight.anchor, driverLeft.anchor, driverRight.size, driverLeft.size);
      this.state.span = span;

      if (!gripR || !gripL) {
        this._lose();
        return this._idle('close both hands to grip');
      }
      if (span < this.minSpan) return this._idle('move your hands apart');

      raw = pairedAngle(driverRight.anchor, driverLeft.anchor);
      firmness = Math.min(driverRight.grip, driverLeft.grip);

      // Keep each hand's own roll calibrated against the pair while we can.
      for (const [side, h] of [['right', driverRight], ['left', driverLeft]]) {
        const delta = angleDelta(handRoll(h.up), raw);
        this._rollOffset[side] = this._rollOffset[side] === null
          ? delta
          : this._rollOffset[side] + angleDelta(this._rollOffset[side], delta) * 0.12;
      }
    } else if (hands.length === 1) {
      // One hand left in frame. Its own roll still says where the wheel is,
      // so rather than giving up the moment a hand reaches the edge of the
      // picture, carry on from the one that is left.
      const lone = hands[0];
      const slot = this.pairs.matchOne(lone);
      const side = slot === null ? null : (slot === this._rightSlot ? 'right' : 'left');
      const offset = side ? this._rollOffset[side] : null;
      const held = side ? this.latches[slot].update(lone.grip) : false;

      if (side === null || offset === null) {
        this._lose();
        return this._idle('show both hands');
      }
      if (!held) {
        this._lose();
        return this._idle('close your hand to grip');
      }

      this.state.grips = slot === this._rightSlot ? [lone.grip, 0] : [0, lone.grip];
      raw = handRoll(lone.up) + offset;
      firmness = lone.grip;
      single = true;
    } else {
      // Hands missing. If we were holding the wheel and they have only just
      // gone, keep hold of it and of the zero reference — they are probably
      // coming straight back, and re-zeroing here is what makes a hand that
      // returns tilted read as straight-ahead.
      if (this.state.holding && this.pairs.remembers) {
        this._lostAt ??= now;
        if (now - this._lostAt <= this.graceMs / 1000) {
          return this._coast(now, 'hands lost — holding');
        }
      }
      for (const latch of this.latches) latch.reset();
      this.pairs.forget();
      this._lose();
      return this._idle('show both hands');
    }

    // Back in frame after a gap — or seen for the first time. Re-anchor the
    // measurement to absolute horizontal and place the wheel there directly,
    // rather than letting the spring drift across to it.
    const reacquired = this._measuredAt === null
      || now - this._measuredAt > this.reanchorMs / 1000;
    this._lostAt = null;
    if (reacquired) {
      this.unwrapper.reset();
      this.filter.reset();
      this._lastAt = null;
    }

    const hand = this.unwrapper.push(raw);

    // Reject impossible jumps — a lost-and-refound hand, not an arm movement.
    // But only for a few frames: if the reading stays there it is the truth,
    // not a glitch, and refusing it forever would wedge the wheel.
    if (this._lastAt !== null) {
      const dt = Math.max(1e-3, now - this._lastAt);
      if (Math.abs(hand - this._lastHand) / dt > this.maxRate && this._rejected < 4) {
        this._rejected++;
        this.unwrapper.last = null;
        this.unwrapper.total = this._lastHand;
        return this._hold('tracking glitch — ignoring');
      }
    }
    this._rejected = 0;
    this._lastAt = now;
    this._lastHand = hand;

    if (this._trimNext) {
      this.trim = hand;
      this._trimNext = false;
    }

    // The measurement is absolute: this is the angle of the driver's hands
    // from horizontal, not a change since some earlier moment.
    // A filter that was just reset returns its first sample untouched, so a
    // re-acquired reading passes straight through with no ramp.
    const level = hand - this.trim;
    const smoothed = this.filter.filter(level, now);

    this.angle = clamp(smoothed * this.ratio, -this.lock, this.lock);

    // Angular velocity of the wheel we are asking for. The controller uses it
    // to lead its spring, which otherwise trails a moving target by a fixed
    // fraction of a second — the dominant source of lag at speed.
    if (this._velAt !== null) {
      const dtv = now - this._velAt;
      if (dtv > 1e-4) {
        const measured = (this.angle - this._velLast) / dtv;
        this._velocity += (measured - this._velocity) * 0.4;
      }
    } else {
      this._velocity = 0;
    }
    this._velAt = now;
    this._velLast = this.angle;
    this._measuredAt = now;

    this.state.holding = true;
    this.state.coasting = false;
    this.state.single = single;
    this.state.handAngle = level;
    this.state.wheelAngle = this.angle;
    this.state.reason = single ? 'one hand — reduced accuracy' : 'holding';

    // Confidence tracks how firmly the hands are closed, so a grip that is
    // slipping hands control back gradually instead of dropping it. One hand
    // is a much shorter baseline and correspondingly noisier, so it never
    // claims full confidence.
    const ceiling = single ? 0.6 : 1;
    return {
      angle: this.angle,
      confidence: clamp((0.45 + firmness * 0.55) * ceiling, 0, 1),
      velocity: reacquired ? 0 : this._velocity,
      // Place the wheel outright on the first frame of a fresh sighting.
      snap: reacquired,
    };
  }

  /**
   * Keep hold of the wheel while the hands are briefly out of frame,
   * surrendering confidence as the gap lengthens so the controller eases off
   * rather than dropping the wheel the instant a hand blinks out.
   */
  _coast(now, reason) {
    const t = clamp((now - this._lostAt) / (this.graceMs / 1000), 0, 1);
    this.state.coasting = true;
    this.state.reason = reason;
    return { angle: this.angle, confidence: clamp(0.85 * (1 - t), 0.06, 1) };
  }

  /** Grip lost: drop the continuity state so the next sighting re-anchors. */
  _lose() {
    this._measuredAt = null;
    this.hands = null;
    this._velocity = 0;
    this._velAt = null;
    this.unwrapper.reset();
    this.filter.reset();
    this._lastAt = null;
    this._lostAt = null;
    this.state.coasting = false;
    this.state.single = false;
    this.state.handAngle = 0;
    this.state.wheelAngle = 0;
  }

  /** Keep the wheel where it is for a frame without taking a new reading. */
  _hold(reason) {
    this.state.reason = reason;
    if (!this.state.holding) return null;
    return { angle: this.angle, confidence: 0.5 };
  }

  _idle(reason) {
    this.state.holding = false;
    this.state.coasting = false;
    this.state.reason = reason;
    return null;
  }
}
