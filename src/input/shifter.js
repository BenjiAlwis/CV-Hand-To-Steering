/**
 * Gear flaps.
 *
 * On a real wheel the paddles sit behind the fascia and you pull them with a
 * finger while the rest of the hand stays wrapped around the grip. That is the
 * gesture this watches for: with the wheel held, straightening the index
 * finger of one hand and curling it back counts as one pull of that side's
 * flap — right for up, left for down, the way the car is laid out.
 *
 * It deliberately reads one finger rather than the whole hand. The grip score
 * averages all four, so a single extended finger barely moves it and the wheel
 * stays firmly held through a shift — which is what you want, because letting
 * go every time you change gear would be useless.
 */
import { FlickDetector } from '../vision/handmath.js';

export class Shifter {
  /**
   * @param {import('./handsource.js').HandTrackingSource} source
   * @param {{onShift: (direction: -1|1) => void}} options
   */
  constructor(source, { onShift, finger = 'index' } = {}) {
    this.source = source;
    this.onShift = onShift ?? (() => {});
    this.finger = finger;
    this.detectors = { right: new FlickDetector(), left: new FlickDetector() };
    /** Switched off in settings, for drivers who would rather use the keys. */
    this.enabled = true;
    /** For the overlay: how far each trigger finger is currently extended. */
    this.state = { right: 0, left: 0, armed: false };
  }

  /** Call once per frame, after the steering source has read. */
  update(nowMs = performance.now()) {
    const hands = this.source.hands;

    // Only while the wheel is actually being held. A hand waved in front of
    // the camera should not be able to change gear. Switched off, the
    // detectors are reset rather than merely ignored, so turning it back on
    // cannot deliver a shift left over from a finger moved while it was off.
    if (!this.enabled || !this.source.state.holding || !hands) {
      for (const d of Object.values(this.detectors)) d.reset();
      this.state.armed = false;
      this.state.right = 0;
      this.state.left = 0;
      return;
    }
    this.state.armed = true;

    for (const [side, direction] of [['right', 1], ['left', -1]]) {
      const extension = hands[side]?.fingers?.[this.finger] ?? 0;
      this.state[side] = extension;
      if (this.detectors[side].update(extension, nowMs)) {
        this.onShift(direction);
      }
    }
  }
}
