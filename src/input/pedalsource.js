/**
 * Feet to pedals.
 *
 * Right foot is the throttle and left foot the brake, as in the car. Each
 * foot is read independently: one can be out of frame without taking the
 * other with it, because losing sight of the brake should not also cut the
 * throttle.
 *
 * The safe failure is different for each pedal, and that asymmetry is the
 * point of this file. A throttle whose foot has vanished must close — a stuck
 * open throttle is the one outcome nobody wants — while a brake whose foot
 * has vanished should simply release rather than slam on. Neither snaps:
 * both ease out over `releaseMs`, so a single dropped frame does not lift the
 * car off the power.
 */
import { PedalCalibrator } from '../vision/footmath.js';
import { clamp } from '../vision/handmath.js';

export class PedalSource {
  /**
   * @param {object} o
   * @param {import('../vision/foottracker.js').FootTracker} o.tracker
   * @param {number} [o.minVisibility] below this a foot is not believed
   * @param {number} [o.staleMs]       frames older than this are ignored
   * @param {number} [o.graceMs]       how long a lost foot is held before it
   *                                    starts to fall, so one dropped frame
   *                                    changes nothing at all
   * @param {number} [o.releaseMs]     how long the fall to 0 then takes
   */
  constructor({ tracker, minVisibility = 0.55, staleMs = 260,
                graceMs = 120, releaseMs = 180 } = {}) {
    this.name = 'pedals';
    this.tracker = tracker;
    this.minVisibility = minVisibility;
    this.staleMs = staleMs;
    this.graceMs = graceMs;
    this.releaseMs = releaseMs;

    this.calibrators = {
      throttle: new PedalCalibrator(),
      brake: new PedalCalibrator(),
    };

    /** What the sim reads. */
    this.throttle = 0;
    this.brake = 0;

    /** Per-pedal detail for the HUD. */
    this.state = {
      throttle: { value: 0, seen: false, visibility: 0, pitch: 0, lostMs: 0 },
      brake: { value: 0, seen: false, visibility: 0, pitch: 0, lostMs: 0 },
      tracking: false,
    };
  }

  /** Forgets the learned rest and travel — used by the HUD's zero button. */
  recalibrate() {
    this.calibrators.throttle.reset();
    this.calibrators.brake.reset();
  }

  /**
   * @param {number} dt seconds
   * @returns {{throttle: number, brake: number}}
   */
  read(dt) {
    const latest = this.tracker?.latest;
    const fresh = latest && performance.now() - latest.at <= this.staleMs;

    this._pedal('throttle', fresh ? latest.right : null, latest?.captureAt, dt);
    this._pedal('brake', fresh ? latest.left : null, latest?.captureAt, dt);

    this.throttle = this.state.throttle.value;
    this.brake = this.state.brake.value;
    this.state.tracking = this.state.throttle.seen || this.state.brake.seen;
    return { throttle: this.throttle, brake: this.brake };
  }

  _pedal(which, foot, captureAt, dt) {
    const s = this.state[which];
    const cal = this.calibrators[which];
    const believable = foot && foot.visibility >= this.minVisibility;

    if (!believable) {
      // Hold, then ease out. A pedal that starts falling on the first frame it
      // is missed gives up nearly a tenth of its travel to a single dropped
      // frame, which on the throttle is felt straight away — and a frame gets
      // dropped whenever a foot passes behind the other one. So nothing moves
      // until the foot has really been gone for `graceMs`, and only then does
      // it ramp down rather than cut.
      s.lostMs += dt * 1000;
      if (s.lostMs > this.graceMs) {
        const fall = this.releaseMs > 0 ? (dt * 1000) / this.releaseMs : 1;
        s.value = Math.max(0, s.value - fall);
      }
      s.seen = false;
      s.visibility = foot?.visibility ?? 0;
      return;
    }

    s.lostMs = 0;
    s.seen = true;
    s.visibility = foot.visibility;
    s.pitch = foot.pitch;
    s.value = clamp(cal.update(foot.pitch, (captureAt ?? performance.now()) / 1000), 0, 1);
  }
}
