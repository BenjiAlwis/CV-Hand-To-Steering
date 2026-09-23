/**
 * Hand geometry: the maths that turns landmarks into "gripping" and "turning".
 *
 * Deliberately pure and free of MediaPipe types — it takes plain arrays of
 * `{x, y}` and nothing else, so the behaviour that actually decides whether
 * the wheel moves can be tested without a camera, a model or a browser.
 *
 * Landmark indices follow MediaPipe's 21-point hand:
 *   0 wrist · 4 thumb tip · 8 index tip · 12 middle tip · 16 ring tip
 *   20 pinky tip, with each finger's MCP knuckle at 5 / 9 / 13 / 17.
 */

export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_TIP: 20,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How far a hand is from a closed fist.
 *
 * Fingertip-to-wrist distance, divided by the hand's own size so it does not
 * change as the driver moves nearer or further from the camera. An open hand
 * puts its tips about twice the knuckle span from the wrist; a fist brings
 * them to roughly one. The thumb is ignored — it stays out on a wheel grip
 * even when the fingers are fully wrapped.
 *
 * @param {{x:number,y:number}[]} lm 21 landmarks
 * @returns {{grip:number, openness:number, size:number, anchor:{x:number,y:number}}}
 */
export function handMetrics(lm) {
  const wrist = lm[LANDMARK.WRIST];
  const size = dist(wrist, lm[LANDMARK.MIDDLE_MCP]) || 1e-6;

  const tips = [LANDMARK.INDEX_TIP, LANDMARK.MIDDLE_TIP, LANDMARK.RING_TIP, LANDMARK.PINKY_TIP];
  let openness = 0;
  for (const t of tips) openness += dist(lm[t], wrist) / size;
  openness /= tips.length;

  const grip = clamp((OPEN_REF - openness) / (OPEN_REF - FIST_REF), 0, 1);

  // Steering is measured between the knuckle lines, not the palms.
  //
  // The wrist travels several millimetres as the fingers close, so any anchor
  // that includes it moves when you make a fist — and the act of gripping
  // would then register as a turn you never made. The four MCP knuckles are
  // rigid relative to each other whatever the fingers are doing.
  const knuckles = [
    lm[LANDMARK.INDEX_MCP], lm[LANDMARK.MIDDLE_MCP],
    lm[LANDMARK.RING_MCP], lm[LANDMARK.PINKY_MCP],
  ];
  const anchor = {
    x: knuckles.reduce((s, p) => s + p.x, 0) / knuckles.length,
    y: knuckles.reduce((s, p) => s + p.y, 0) / knuckles.length,
  };

  // Which way is up, according to the hand itself.
  //
  // Grip a wheel with your thumb on top and your index knuckle sits above
  // your little finger's — for either hand. So the knuckle line points at the
  // top of the wheel, and it keeps pointing there however the wheel is
  // turned, because it turns with you. That makes it a far better statement
  // of orientation than a left/right label, which is one convention mismatch
  // away from inverting the steering.
  const up = normalise({
    x: lm[LANDMARK.INDEX_MCP].x - lm[LANDMARK.PINKY_MCP].x,
    y: lm[LANDMARK.INDEX_MCP].y - lm[LANDMARK.PINKY_MCP].y,
  });

  // Per-finger extension, in the same hand-sizes as `openness`. Pulling a
  // gear paddle is a finger movement, not a hand movement: the fist stays
  // closed on the grip while one finger reaches. Averaging the fingers into a
  // single grip number throws that away, so the individual values are kept.
  const fingers = {
    index: dist(lm[LANDMARK.INDEX_TIP], wrist) / size,
    middle: dist(lm[LANDMARK.MIDDLE_TIP], wrist) / size,
    ring: dist(lm[LANDMARK.RING_TIP], wrist) / size,
    pinky: dist(lm[LANDMARK.PINKY_TIP], wrist) / size,
  };

  return { grip, openness, size, anchor, up, fingers };
}

/** Fingertip spans, in hand-sizes, for a flat hand and for a closed fist. */
const OPEN_REF = 2.05;
const FIST_REF = 1.15;

/**
 * The angle of the line joining two hands, as a wheel angle in radians.
 *
 * Positive turns the wheel to the driver's right.
 *
 * Works in raw camera space — x right, y **down**, and not mirrored. The
 * camera faces the driver, so their right hand appears on the left of the
 * frame. Turning right drops their right hand and lifts their left, which in
 * the raw frame lowers the left-hand point and raises the right-hand one;
 * `atan2` on a y-down axis reports that as negative, hence the sign flip.
 *
 * @param {{x:number,y:number}} a knuckle anchor of either hand
 * @param {{x:number,y:number}} b knuckle anchor of the other
 */
export function steeringAngleFromHands(a, b) {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  return -Math.atan2(right.y - left.y, right.x - left.x);
}

/**
 * The same measurement, but for an already-paired set of hands.
 *
 * Takes the hands in a fixed order rather than re-deciding which is which, so
 * the result stays continuous when they cross over.
 *
 * @param {{x:number,y:number}} first  the hand held in slot 0
 * @param {{x:number,y:number}} second the hand held in slot 1
 */
export function pairedAngle(first, second) {
  return -Math.atan2(second.y - first.y, second.x - first.x);
}

/** How far apart two hands are, in units of the larger hand's size. */
export function handSpan(a, b, sizeA, sizeB) {
  return dist(a, b) / Math.max(sizeA, sizeB, 1e-6);
}

/**
 * Grip state with hysteresis.
 *
 * A single threshold chatters: hold a hand right at the boundary and the
 * wheel grabs and releases every few frames. Engaging and releasing at
 * different values, and requiring a few consecutive frames either way, makes
 * the transition feel like a switch instead of a rattle.
 */
export class GripLatch {
  constructor({ engage = 0.55, release = 0.32, frames = 2 } = {}) {
    this.engage = engage;
    this.release = release;
    this.frames = frames;
    this.held = false;
    this._count = 0;
  }

  /** @param {number} score 0..1 from `handMetrics` */
  update(score) {
    const wants = this.held ? score > this.release : score > this.engage;
    if (wants === this.held) {
      this._count = 0;
    } else if (++this._count >= this.frames) {
      this.held = wants;
      this._count = 0;
    }
    return this.held;
  }

  reset() {
    this.held = false;
    this._count = 0;
  }
}

/**
 * The wheel angle a single hand implies, from its own roll.
 *
 * A hand gripping a wheel turns with it, so the knuckle line points at the
 * wheel's top whatever the angle — which means one hand is enough to say where
 * the wheel is. It is a far shorter baseline than the span between two hands,
 * perhaps 25 mm against 250, so the same landmark noise costs roughly ten
 * times the angular error. Useful as a fallback when the other hand has left
 * the frame; not a substitute for the pair.
 *
 * @param {{x:number,y:number}} up the hand's knuckle-line direction
 */
export function handRoll(up) {
  return Math.atan2(-up.x, -up.y);
}

/**
 * Puts two hands the right way up.
 *
 * The line between two hands is ambiguous: read it one way and the wheel is
 * upright, read it the other and it is half a turn out. Nothing about the
 * hands' positions resolves that — but their thumbs do. Both index knuckles
 * point toward the top of the wheel in a normal grip, so the pair is ordered
 * such that the wheel's own "up" agrees with them.
 *
 * Because the thumbs turn with the wheel, this stays correct through the
 * whole range of lock rather than only near centre.
 *
 * @param {{anchor:{x,y}, up:{x,y}}} first
 * @param {{anchor:{x,y}, up:{x,y}}} second
 * @returns the same two hands, ordered so `pairedAngle` reads upright
 */
export function orientPair(first, second) {
  // Where the hands say the top of the wheel is.
  const thumbs = normalise({
    x: (first.up?.x ?? 0) + (second.up?.x ?? 0),
    y: (first.up?.y ?? 0) + (second.up?.y ?? 0),
  });
  // Where this ordering would put it: the hand line turned a quarter turn.
  const dx = second.anchor.x - first.anchor.x;
  const dy = second.anchor.y - first.anchor.y;
  const wheelUp = normalise({ x: dy, y: -dx });

  const agreement = wheelUp.x * thumbs.x + wheelUp.y * thumbs.y;

  // Thumbs pointing in opposite directions cancel out and say nothing; leave
  // the order alone rather than flipping on noise.
  if (!Number.isFinite(agreement) || Math.abs(agreement) < 1e-3) return [first, second];

  return agreement >= 0 ? [first, second] : [second, first];
}

function normalise(v) {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/**
 * Edge detector for a finger flick.
 *
 * Fires once when a finger straightens, and not again until it has curled
 * back. Two thresholds rather than one, because a finger held near the
 * boundary would otherwise machine-gun shifts; and a short refractory period
 * after each shift, because the knuckles shift slightly as the finger moves
 * and the detector can otherwise see its own follow-through as a second pull.
 */
export class FlickDetector {
  /**
   * @param {object} o
   * @param {number} o.extend   extension, in hand-sizes, that counts as a pull
   * @param {number} o.retract  and the value it must fall back below first
   */
  constructor({ extend = 1.72, retract = 1.46, refractoryMs = 220 } = {}) {
    this.extend = extend;
    this.retract = retract;
    this.refractoryMs = refractoryMs;
    this.armed = true;
    this.lastFire = -Infinity;
  }

  /**
   * @param {number} extension from `handMetrics().fingers`
   * @param {number} nowMs
   * @returns {boolean} true only on the frame the pull is recognised
   */
  update(extension, nowMs) {
    if (extension < this.retract) {
      this.armed = true;
      return false;
    }
    if (extension > this.extend && this.armed) {
      if (nowMs - this.lastFire < this.refractoryMs) return false;
      this.armed = false;
      this.lastFire = nowMs;
      return true;
    }
    return false;
  }

  reset() {
    this.armed = true;
    this.lastFire = -Infinity;
  }
}

/** Shortest signed step from one angle to another. */
export function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Keeps a continuously increasing angle from a wrapped measurement.
 *
 * `atan2` only ever reports −π…π, so a hand rotation that crosses the seam
 * looks like a full turn the other way. Accumulating the short step each
 * frame instead lets the driver wind past a half turn without the wheel
 * snapping back.
 */
export class AngleUnwrapper {
  constructor() {
    this.last = null;
    this.total = 0;
  }

  push(wrapped) {
    if (this.last === null) {
      this.last = wrapped;
      this.total = wrapped;
      return this.total;
    }
    this.total += angleDelta(this.last, wrapped);
    this.last = wrapped;
    return this.total;
  }

  reset() {
    this.last = null;
    this.total = 0;
  }
}

/**
 * One-Euro filter.
 *
 * A fixed smoothing factor has to choose between jitter and lag: enough
 * smoothing to settle a still hand always drags behind a fast one. This
 * raises its own cutoff in proportion to how quickly the signal is moving, so
 * a hand held still is heavily filtered and a hand thrown into a corner is
 * barely touched.
 *
 * Géry Casiez, Nicolas Roussel, Daniel Vogel — CHI 2012.
 */
export class OneEuroFilter {
  /**
   * @param {object} o
   * Defaults are tuned against measured landmark jitter (±0.02 rad peak,
   * 0.0115 rms on a still hand): they cut that to about 0.003 rms while still
   * following a brisk 1.5 rad/s arm rotation to within 2%.
   *
   * @param {number} o.minCutoff Hz — lower means steadier when still.
   * @param {number} o.beta      how sharply the cutoff opens up with speed.
   *                             In units of Hz per radian/second, so for a
   *                             signal in radians it needs to be around 1,
   *                             not the 0.007 quoted for pixel coordinates.
   */
  constructor({ minCutoff = 0.8, beta = 1.2, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.value = null;
    this.deriv = 0;
    this.lastAt = null;
  }

  /**
   * @param {number} value
   * @param {number} at timestamp in seconds
   */
  filter(value, at) {
    if (this.value === null) {
      this.value = value;
      this.lastAt = at;
      return value;
    }

    const dt = Math.max(1e-3, at - this.lastAt);
    this.lastAt = at;

    const rate = (value - this.value) / dt;
    this.deriv += alphaFor(this.dCutoff, dt) * (rate - this.deriv);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.deriv);
    this.value += alphaFor(cutoff, dt) * (value - this.value);
    return this.value;
  }
}

function alphaFor(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Keeps the same physical hand in the same slot from frame to frame.
 *
 * Identity only. Which way up the pair reads is decided separately, by
 * `orientPair`, from the hands' own orientation.
 *
 * Sorting the two hands by x every frame is the obvious approach and it
 * breaks: past about a quarter turn the hands pass through vertical and swap
 * sides in the image, so the vector between them flips and the steering angle
 * jumps by half a turn — right at the point where the driver is asking for
 * full lock. Matching each detection to whichever slot it was nearest to last
 * frame keeps the pairing stable all the way round.
 */
export class HandPairTracker {
  /** @param {number} maxJump how far a hand may travel between frames, in frame widths */
  constructor({ maxJump = 0.28 } = {}) {
    this.maxJump = maxJump;
    this.slots = [null, null];
    /** Consecutive frames without a usable pair. */
    this.missing = 0;
  }

  /**
   * Matches a lone detection to whichever slot it was nearest to.
   *
   * @param {{anchor:{x:number,y:number}}} hand
   * @returns {0|1|null} the slot it belongs to, or null if nothing is remembered
   */
  matchOne(hand) {
    if (!this.remembers) return null;
    const slot = sq(hand.anchor, this.slots[0]) <= sq(hand.anchor, this.slots[1]) ? 0 : 1;
    this.slots[slot] = { ...hand.anchor };
    return slot;
  }

  /** Throws the pairing away. Call when the driver has genuinely let go. */
  forget() {
    this.slots = [null, null];
    this.missing = 0;
  }

  /** Is a pairing remembered that a returning hand could be matched back to? */
  get remembers() {
    return this.slots[0] !== null && this.slots[1] !== null;
  }

  /**
   * @param {Array<{anchor:{x:number,y:number}, handedness?:string|null}>} hands
   * @returns {Array|null} the two hands in stable slot order, or null
   */
  update(hands) {
    if (hands.length !== 2) {
      // Deliberately keep the slots. A hand leaving the frame for a moment —
      // or the detector simply missing one for a frame, which it does often —
      // must not throw away which hand was which. The caller decides how long
      // to coast before calling `forget`.
      this.missing++;
      return null;
    }
    this.missing = 0;

    const [p, q] = hands;

    // Handedness first, always — for *identity*, not for orientation.
    //
    // This decides which hand keeps which slot from frame to frame, so the
    // unwrapped angle stays continuous. It comes from the hand's anatomy, so
    // it is indifferent to where the hands are on screen and to how far they
    // moved since the last frame. Proximity is not: move both hands a long
    // way between sightings — let go at one angle and take hold again at
    // another — and the "closest" pairing is quite often the swapped one.
    //
    // Which way *up* the resulting pair should be read is a separate question
    // and a label cannot answer it; `orientPair` reads the thumbs instead.
    if (p.handedness && q.handedness && p.handedness !== q.handedness) {
      const ordered = p.handedness === 'Left' ? [p, q] : [q, p];
      this._remember(ordered);
      return ordered;
    }

    if (!this.remembers) return this._seed(p, q);

    // No usable labels: fall back to whichever assignment moved less.
    const keep = sq(p.anchor, this.slots[0]) + sq(q.anchor, this.slots[1]);
    const swap = sq(q.anchor, this.slots[0]) + sq(p.anchor, this.slots[1]);
    const ordered = keep <= swap ? [p, q] : [q, p];

    // Hands that were out of frame have had longer to move, so the plausible
    // displacement grows with the length of the gap.
    const allowed = this.maxJump * (1 + Math.min(this.missing, 20) * 0.35);
    const moved = Math.max(
      Math.hypot(ordered[0].anchor.x - this.slots[0].x, ordered[0].anchor.y - this.slots[0].y),
      Math.hypot(ordered[1].anchor.x - this.slots[1].x, ordered[1].anchor.y - this.slots[1].y),
    );
    if (moved > allowed) return this._seed(p, q);

    this._remember(ordered);
    return ordered;
  }

  /**
   * Assign two fresh detections to slots.
   *
   * Prefers the detector's own handedness, which is derived from the hand's
   * anatomy and so does not care how the hands are oriented. Falling back to
   * screen order — the obvious choice — is what makes a hand that returns to
   * frame tilted past vertical land in the wrong slot and flip the steering
   * angle by half a turn.
   */
  _seed(p, q) {
    let ordered;
    if (p.handedness && q.handedness && p.handedness !== q.handedness) {
      ordered = p.handedness === 'Left' ? [p, q] : [q, p];
    } else {
      ordered = p.anchor.x <= q.anchor.x ? [p, q] : [q, p];
    }
    this._remember(ordered);
    return ordered;
  }

  _remember(ordered) {
    this.slots = ordered.map((h) => ({ ...h.anchor }));
  }

  /** Kept for callers that want a hard reset; same as `forget`. */
  reset() {
    this.forget();
  }
}

const sq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
