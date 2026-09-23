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
  constructor({ travel = 0.35, minTravel = 0.16, deadzone = 0.12,
                restRise = 6.0, restFall = 0.05, filter } = {}) {
    this.initialTravel = travel;
    this.minTravel = minTravel;
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
    if (below > this.travel) this.travel = below;       // a firmer press than we knew
    const span = Math.max(this.minTravel, this.travel);

    const raw = clamp(below / span, 0, 1);
    // The deadzone is taken off the top and the rest rescaled, so the pedal
    // still reaches a true 1 rather than stopping short of it.
    this.value = raw <= this.deadzone ? 0 : (raw - this.deadzone) / (1 - this.deadzone);
    return this.value;
  }
}

export { clamp };
