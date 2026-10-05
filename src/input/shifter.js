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

/** How long the flaps stay live after the grip was last held, ms. */
const HOLD_GRACE_MS = 500;
/**
 * A flap pull is one finger straightening while the rest stay wrapped round
 * the grip. If the other three are out too — mean extension past this, in
 * hand-sizes; a fist is about 1.15, a loose grip round a rim 1.4–1.7, a
 * flat hand 2.05 — the hand is opening, letting go of the wheel, and that is
 * never a pull.
 */
const OTHERS_OPEN = 1.75;

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
    this.state = { right: 0, left: 0, armed: false, pulled: { right: false, left: false }, progress: { right: 0, left: 0 } };
    /** When the wheel was last held, ms, or null. */
    this._heldAt = null;
  }

  /** Call once per frame, after the steering source has read. */
  update(nowMs = performance.now()) {
    // Only while the wheel is held — or was, a moment ago. Straightening a
    // finger to pull a flap loosens the grip reading too, and on a loose or
    // gloved grip that one frame can read as letting go; dropping the flaps
    // there threw away exactly the pull that caused it. So they stay live for
    // `HOLD_GRACE_MS` after the grip was last held, watching the hands the
    // tracker last saw. A hand waved in front of a camera with no wheel held
    // still cannot change gear. Switched off, the detectors are reset rather
    // than merely ignored, so turning it back on cannot deliver a shift left
    // over from a finger moved while it was off.
    if (this.source.state.holding) this._heldAt = nowMs;
    const recent = this._heldAt !== null && nowMs - this._heldAt <= HOLD_GRACE_MS;
    const hands = this.source.state.holding ? this.source.hands : recent ? (this.source.seenHands ?? null) : null;
    if (!this.enabled || !recent || !hands) {
      for (const d of Object.values(this.detectors)) d.reset();
      this.state.armed = false;
      this.state.right = 0;
      this.state.left = 0;
      return;
    }
    this.state.armed = true;

    for (const [side, direction] of [['right', 1], ['left', -1]]) {
      const extension = hands[side]?.fingers?.[this.finger];
      // A hand missing from this frame is not a curled finger: skip it rather
      // than feed the detector a zero that would re-arm it mid-pull.
      if (extension === undefined) continue;
      const detector = this.detectors[side];
      this.state[side] = extension;
      const f = hands[side].fingers;
      const others = (f.middle + f.ring + f.pinky) / 3;
      if (others > OTHERS_OPEN) {
        // Opening the hand: hold the detector off until the finger curls back.
        detector.armed = false;
      } else if (detector.update(extension, nowMs, others)) {
        this.onShift(direction);
      }
      this.state.pulled[side] = !detector.armed;
      this.state.progress[side] = detector.progress(extension, others);
    }
  }
}

/**
 * One gear change per intent, whichever input it came from.
 *
 * With a real wheel in front of the camera there are two ways to shift at
 * once: the paddle on the rim, and the finger the camera watches reaching
 * for it. Pulling a paddle moves the index finger, so a single pull can
 * arrive as a paddle shift and a finger shift a few frames apart — two gears
 * for one pull. A shift in the same direction from a different input inside
 * `windowMs` is taken as the same pull and dropped.
 *
 * Repeats from the same input always pass: two quick pulls of one paddle are
 * two shifts, and the finger detector already has its own refractory period.
 */
export class ShiftGate {
  constructor({ windowMs = 300 } = {}) {
    this.windowMs = windowMs;
    this.last = null;
  }

  /**
   * @param {-1|1} direction
   * @param {string} from  'paddle', 'fingers', 'keys', 'menu'…
   * @returns {boolean} whether this is a new shift
   */
  accept(direction, from, nowMs = performance.now()) {
    const last = this.last;
    // One pull may arrive by more than one route — the paddle and the finger
    // the camera saw pull it, in either order. Every route it has come by is
    // remembered: another route inside the window is that same pull again
    // and is dropped, while one it has already come by is a new pull.
    if (last && last.direction === direction && !last.routes.has(from) && nowMs - last.at < this.windowMs) {
      last.routes.add(from);
      return false;
    }
    this.last = { direction, routes: new Set([from]), at: nowMs };
    return true;
  }
}
