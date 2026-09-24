/**
 * Turning pose landmarks into pedal travel.
 *
 * Pure maths, no camera and no model — everything here runs under plain Node,
 * which is how `tools/check-pedals.mjs` tests it.
 *
 * The driver is not sitting at a pedal box. They are sitting with their heels
 * on the floor, pivoting each foot at the ankle, so the signal that carries
 * a pedal press is the *pitch* of the foot: the toe drops as the pedal goes
 * down and rises as it comes off. Pitch is the right scalar to read rather
 * than the toe's height in frame, because it is a ratio of two points on the
 * same foot — it does not change when the driver shifts their chair, and it
 * does not care how far the camera is away.
 */
import { clamp, OneEuroFilter } from './handmath.js';

/** The pose landmarks this file uses. MediaPipe Pose has 33 in total. */
export const POSE = {
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_TOE: 31, RIGHT_TOE: 32,
};

const SIDES = {
  left: { ankle: POSE.LEFT_ANKLE, heel: POSE.LEFT_HEEL, toe: POSE.LEFT_TOE },
  right: { ankle: POSE.RIGHT_ANKLE, heel: POSE.RIGHT_HEEL, toe: POSE.RIGHT_TOE },
};

/**
 * Reads one foot out of a pose result.
 *
 * @param {Array<{x:number,y:number,visibility?:number}>} lm  pose landmarks
 * @param {'left'|'right'} side  the driver's own left and right, as the model
 *   labels them — not which side of the picture the foot appears on.
 * @returns {{heel:object, toe:object, ankle:object, pitch:number,
 *            length:number, visibility:number} | null}
 */
export function footMetrics(lm, side) {
  const idx = SIDES[side];
  if (!lm || !idx) return null;
  const ankle = lm[idx.ankle];
  const heel = lm[idx.heel];
  const toe = lm[idx.toe];
  if (!ankle || !heel || !toe) return null;

  const dx = toe.x - heel.x;
  const dy = toe.y - heel.y;
  const length = Math.hypot(dx, dy);

  // A foot seen almost end-on is a few pixels long, and its pitch is then
  // mostly noise. Report it rather than pretending to a reading.
  const pitch = length < 1e-4 ? 0 : Math.asin(clamp(-dy / length, -1, 1));

  // The three points vote. A foot half out of frame usually loses the toe
  // first, which is the one that carries the signal, so the lowest score is
  // the honest one to report.
  const visibility = Math.min(
    ankle.visibility ?? 1, heel.visibility ?? 1, toe.visibility ?? 1,
  );

  return { ankle, heel, toe, pitch, length, visibility };
}

/**
 * Maps a foot's pitch onto 0…1 of pedal travel.
 *
 * There is no fixed angle that means "flat out", because it depends on the
 * driver, the chair and where the camera is sitting. So rest and travel are
 * both learned:
 *
 *   rest   the pitch the foot returns to, tracked as the highest pitch seen
 *          recently. Learned quickly upward (a foot that lifts higher than
 *          we thought possible is the new rest) and slowly downward, so a
 *          long press does not drag the rest point down with it.
 *
 *   travel how far below rest counts as fully pressed. It starts at a sane
 *          default and grows to fit a driver who presses further, which means
 *          the first firm press calibrates the pedal and every one after it
 *          lands in the same place.
 */
export class PedalCalibrator {
  /**
   * @param {object} o
   * @param {number} o.travel    initial full-press span, radians (~20°)
   * @param {number} o.minTravel never scale a press into less than this
   * @param {number} o.deadzone  fraction of travel ignored at the top, so a
   *                             foot resting naturally reads as exactly zero
   */
  constructor({ travel = 0.35, minTravel = 0.16, maxTravel = 0.70, travelDecay = 0.06,
                deadzone = 0.12, restRise = 6.0, restFall = 0.05, filter } = {}) {
    this.initialTravel = travel;
    this.minTravel = minTravel;
    /**
     * A ceiling on learned travel, and a slow pull back toward the default.
     *
     * Travel grows to fit the driver, which is what makes the first firm press
     * calibrate the pedal — but growing only, with no ceiling, means one bad
     * frame sets it forever. Measured on a real foot camera, pitch swung 134°
     * across fifteen seconds where the foot itself moved perhaps 30: landmarks
     * jump when a foot is half occluded. A single spike like that would have
     * demanded a 134° press from then on, which is to say the pedal would
     * never open again. So travel is capped at a press no ankle makes, and
     * eases back toward the default when it is not being used.
     */
    this.maxTravel = maxTravel;
    this.travelDecay = travelDecay;
    this.deadzone = deadzone;
    this.restRise = restRise;
    this.restFall = restFall;
    this._filter = new OneEuroFilter(filter ?? { minCutoff: 1.4, beta: 0.9 });
    this.reset();
  }

  reset() {
    this.rest = null;
    this.travel = this.initialTravel;
    this.value = 0;
    this._filter.reset();
  }

  /**
   * @param {number} pitch  radians, from `footMetrics`
   * @param {number} at     timestamp in seconds
   * @returns {number} 0…1
   */
  update(pitch, at) {
    const p = this._filter.filter(pitch, at);

    if (this.rest === null) {
      this.rest = p;
      this.value = 0;
      this._lastAt = at;
      return 0;
    }

    const dt = clamp(at - (this._lastAt ?? at), 0, 0.2);
    this._lastAt = at;

    // Rest chases upward fast and sinks slowly. The asymmetry is the whole
    // trick: lifting the foot re-zeroes the pedal almost at once, while
    // holding it down does not drag the zero down after it.
    //
    // Sinking is also scaled by how far the pedal is currently open, which is
    // what actually stops the bleed. A plain slow decay still gave up a third
    // of a held pedal over ten seconds — the car quietly coming off the power
    // mid-corner — because "slow" is still relentless when the input never
    // returns to rest. At full travel the zero is frozen outright, and it only
    // adapts at its full rate once the foot is genuinely back up.
    const rate = p > this.rest ? this.restRise : this.restFall * (1 - this.value);
    this.rest += (p - this.rest) * clamp(rate * dt, 0, 1);

    const below = this.rest - p;
    if (below > this.travel) this.travel = Math.min(below, this.maxTravel);
    else this.travel += (this.initialTravel - this.travel) * clamp(this.travelDecay * dt, 0, 1);
    const span = clamp(this.travel, this.minTravel, this.maxTravel);

    const raw = clamp(below / span, 0, 1);
    // The deadzone is taken off the top and the rest rescaled, so the pedal
    // still reaches a true 1 rather than stopping short of it.
    this.value = raw <= this.deadzone ? 0 : (raw - this.deadzone) / (1 - this.deadzone);
    return this.value;
  }
}

export { clamp };

/**
 * Why the feet are not being tracked, and what to do about it.
 *
 * Measured on a real rig, every one of these states looks identical from the
 * outside — the pedals simply do not move — and they need opposite things
 * done about them. A camera 30cm from one sole and a camera across the room
 * both report "no feet"; one needs to move back and the other forward.
 *
 * The advice is ordered by what has to be true first. There is no point
 * telling someone to centre their feet when the model cannot find a person,
 * and no point talking about visibility when only one foot is in the picture.
 *
 * @param {object} o
 * @param {boolean} o.sawPerson      whether the pose graph found anyone
 * @param {object|null} o.left       from `footMetrics`
 * @param {object|null} o.right
 * @param {number} [o.gate]          the visibility a foot must reach
 * @returns {{ok: boolean, code: string, message: string}}
 */
export function framingAdvice({ sawPerson, left, right, gate = 0.30 } = {}) {
  const say = (ok, code, message) => ({ ok, code, message });

  if (!sawPerson) {
    return say(false, 'no-person',
      'nobody in shot — the model finds feet by finding you, so move the camera back until your shins are in the picture');
  }

  const seen = { left: (left?.visibility ?? 0) >= gate, right: (right?.visibility ?? 0) >= gate };

  if (!seen.left && !seen.right) {
    return say(false, 'no-feet',
      'you are in shot but your feet are not — angle the camera down, or move it back');
  }

  if (!seen.left || !seen.right) {
    const missing = seen.left ? 'right' : 'left';
    return say(false, 'one-foot',
      `only your ${seen.left ? 'left' : 'right'} foot is being seen — both have to be in frame, ` +
      `or the ${missing === 'right' ? 'throttle' : 'brake'} has nothing to read`);
  }

  // Both feet are there. Now the things that make a good read a bad one.
  //
  // Too close is tested before too near the edge, because a foot that fills
  // the frame is also touching its edge, and "move the camera back" is the
  // instruction that fixes both. Told to centre their feet instead, someone
  // would shuffle a foot that cannot fit wherever they put it.
  const TOO_CLOSE = 0.34;
  if (Math.max(left.length, right.length) > TOO_CLOSE) {
    return say(false, 'too-close',
      'the camera is very close — move it back until both feet fit with room to spare');
  }

  const EDGE = 0.06;
  const atEdge = [left, right].some((f) =>
    [f.heel, f.toe, f.ankle].some((p) =>
      p.x < EDGE || p.x > 1 - EDGE || p.y < EDGE || p.y > 1 - EDGE));
  if (atEdge) {
    return say(false, 'at-edge',
      'your feet are against the edge of the frame — they will drop out as you move, so leave some room around them');
  }

  // Foreshortening: seen end-on, a foot barely changes shape as it pivots, so
  // there is nothing for the pedal to read even though tracking looks fine.
  const TOO_SHORT = 0.05;
  if (Math.min(left.length, right.length) < TOO_SHORT) {
    return say(false, 'end-on',
      'your feet are pointing at the camera, so pressing barely changes what it sees — move it more to one side');
  }

  return say(true, 'ok', 'both feet tracking');
}

/**
 * A pedal signal from a silhouette, for when the pose graph has no feet.
 *
 * The segmentation detector finds feet a camera close to the floor can see
 * and the pose graph cannot, because it does not need a person attached. What
 * it gives back is a region, not joints — so there is no ankle to measure a
 * pitch from, and the signal has to come out of the shape itself.
 *
 * What it uses is where the region's mass sits within its own height. A foot
 * pivoting at the heel moves its bulk downward as the toe goes down and
 * upward as it lifts, and expressing that as a fraction of the region's own
 * height makes it independent of how big the foot is in frame and where in
 * the picture it sits — the same reasons pitch was chosen over the toe's
 * height when there were joints to work with.
 *
 * Returned the same way round as `footMetrics().pitch`: larger means lifted,
 * so `PedalCalibrator` can take either without knowing which it has.
 *
 * NOT VALIDATED against a real foot camera. The arithmetic is tested; whether
 * a foot working a pedal actually moves this number is not, because it needs
 * a camera pointed at feet to find out. It is a fallback, used only where the
 * alternative is a pedal that does not move at all.
 *
 * @param {{y0:number, y1:number, cy:number}} blob from `findBlobs`
 * @returns {number|null} roughly -1…1, or null if the region is too flat to read
 */
export function silhouettePitch(blob) {
  if (!blob) return null;
  const height = blob.y1 - blob.y0;
  // A region a few pixels tall carries no shape to read, and dividing by it
  // turns rounding into a pedal input.
  if (!(height > 0.02)) return null;
  const through = (blob.cy - blob.y0) / height;
  // Centred on zero so it reads like an angle either side of level.
  return clamp((0.5 - through) * 2, -1, 1);
}
