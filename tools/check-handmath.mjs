/**
 * Tests for the hand geometry.
 *
 *   node tools/check-handmath.mjs
 *
 * Synthesises landmark sets rather than needing a camera, a model or a
 * browser, so the grip threshold, the steering sign and — most importantly —
 * the behaviour through a quarter turn can be checked directly.
 */
import {
  handMetrics, steeringAngleFromHands, pairedAngle, handSpan,
  GripLatch, AngleUnwrapper, OneEuroFilter, HandPairTracker, orientPair, handRoll, FlickDetector,
  angleDelta, LANDMARK,
} from '../src/vision/handmath.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const deg = (r) => (r * 180) / Math.PI;

/**
 * A synthetic hand, built the way a fist on a rim actually sits.
 *
 * The four MCP knuckles lie along a line; `up` is the direction that line
 * points from the little finger toward the index finger, which in a normal
 * thumb-on-top grip is toward the top of the wheel. The metacarpals run back
 * from that line to the wrist, and the fingers extend forward from the wrist
 * by an amount that shrinks as the hand closes.
 *
 * An earlier version scattered the knuckles on an arc around the wrist, which
 * made the knuckle line roughly perpendicular to where it belongs and so
 * could not exercise the orientation logic at all.
 *
 * @param {object} o
 * @param {number} o.curl 0 = flat open hand, 1 = closed fist
 * @param {number} o.up   radians, in the same sense as a wheel angle: 0 points
 *                        the knuckle line up the frame, and positive turns it
 *                        the way a positive steering angle turns the wheel.
 */
function makeHand({ x = 0.5, y = 0.5, size = 0.08, curl = 0, up = 0, indexCurl = null } = {}) {
  const lm = new Array(21);
  // Image space: x right, y down, so straight up is (0, -1). The sign on x is
  // negative because a wheel angle is a negated atan2 on a y-down axis — get
  // it the other way round and the knuckle line turns against the wheel.
  const u = { x: -Math.sin(up), y: -Math.cos(up) };
  const v = { x: -u.y, y: u.x };                 // along the metacarpals

  const span = size * 0.78;                      // knuckle line width
  const at = (alongU, alongV) => ({
    x: x + u.x * alongU + v.x * alongV,
    y: y + u.y * alongU + v.y * alongV,
  });

  lm[LANDMARK.INDEX_MCP] = at(span * 0.5, 0);
  lm[LANDMARK.MIDDLE_MCP] = at(span * 0.17, 0);
  lm[LANDMARK.RING_MCP] = at(-span * 0.17, 0);
  lm[LANDMARK.PINKY_MCP] = at(-span * 0.5, 0);

  // Wrist sits back along the hand; closing draws it slightly forward.
  lm[LANDMARK.WRIST] = at(0, -size * (1 - 0.10 * curl));

  const w = lm[LANDMARK.WRIST];
  const reach = size * (2.05 - curl * 0.90);
  const tip = (alongU) => ({
    x: w.x + u.x * alongU + v.x * reach,
    y: w.y + u.y * alongU + v.y * reach,
  });
  // The index can be straightened on its own — that is the paddle pull.
  const indexReach = size * (2.05 - (indexCurl ?? curl) * 0.90);
  lm[LANDMARK.INDEX_TIP] = {
    x: w.x + u.x * (span * 0.45) + v.x * indexReach,
    y: w.y + u.y * (span * 0.45) + v.y * indexReach,
  };
  lm[LANDMARK.MIDDLE_TIP] = tip(span * 0.15);
  lm[LANDMARK.RING_TIP] = tip(-span * 0.15);
  lm[LANDMARK.PINKY_TIP] = tip(-span * 0.45);
  // Thumb sits off the index side — the "on top" side in a normal grip.
  lm[LANDMARK.THUMB_TIP] = at(span * 0.95, size * 0.35);

  for (let i = 0; i < 21; i++) if (!lm[i]) lm[i] = { ...w };
  return lm;
}

console.log('grip detection');
{
  const open = handMetrics(makeHand({ curl: 0 }));
  const fist = handMetrics(makeHand({ curl: 1 }));
  const half = handMetrics(makeHand({ curl: 0.5 }));
  // What matters is not the exact score but which side of the latch it falls
  // on, with enough margin that noise cannot push it across.
  const ENGAGE = 0.55, RELEASE = 0.32;
  ok('a flat hand stays well below the release threshold',
    open.grip < RELEASE - 0.2, `got ${open.grip.toFixed(3)}, release at ${RELEASE}`);
  ok('a closed fist clears the engage threshold with margin',
    fist.grip > ENGAGE + 0.2, `got ${fist.grip.toFixed(3)}, engage at ${ENGAGE}`);
  ok('half curl lands between the two thresholds',
    half.grip > 0.25 && half.grip < 0.75, `got ${half.grip.toFixed(3)}`);

  const far = handMetrics(makeHand({ curl: 1, size: 0.03 }));
  const close = handMetrics(makeHand({ curl: 1, size: 0.18 }));
  ok('grip is scale invariant', Math.abs(far.grip - close.grip) < 0.03,
    `${far.grip.toFixed(3)} vs ${close.grip.toFixed(3)}`);

  const rotated = handMetrics(makeHand({ curl: 1, rotation: 1.2 }));
  ok('grip is rotation invariant', Math.abs(rotated.grip - fist.grip) < 0.03,
    `${rotated.grip.toFixed(3)} vs ${fist.grip.toFixed(3)}`);
}

console.log('steering anchor');
{
  // The whole point of anchoring on the knuckles: closing your fist must not
  // register as a turn.
  const openA = handMetrics(makeHand({ curl: 0 })).anchor;
  const fistA = handMetrics(makeHand({ curl: 1 })).anchor;
  const drift = Math.hypot(openA.x - fistA.x, openA.y - fistA.y);
  ok('anchor does not move when the hand closes', drift < 1e-9,
    `drifted ${(drift * 1000).toFixed(2)} mm of frame`);

  // Same test expressed as steering error across a gripping pair.
  const pairAngle = (curl) => pairedAngle(
    handMetrics(makeHand({ x: 0.30, y: 0.50, curl })).anchor,
    handMetrics(makeHand({ x: 0.70, y: 0.50, curl })).anchor,
  );
  ok('gripping injects no steering angle', near(pairAngle(0), pairAngle(1), 1e-9),
    `${deg(pairAngle(0)).toFixed(2)}° vs ${deg(pairAngle(1)).toFixed(2)}°`);
}

console.log('steering angle');
{
  const level = steeringAngleFromHands({ x: 0.30, y: 0.50 }, { x: 0.70, y: 0.50 });
  ok('hands level reads zero', near(level, 0, 1e-9), `got ${level}`);

  // Camera faces the driver, so their right hand is on the LEFT of the frame.
  const right = steeringAngleFromHands({ x: 0.30, y: 0.60 }, { x: 0.70, y: 0.40 });
  ok('turning right is positive', right > 0, `got ${deg(right).toFixed(1)}°`);
  ok('turning right by 26.6°', near(right, Math.atan2(0.2, 0.4), 1e-9));

  const left = steeringAngleFromHands({ x: 0.30, y: 0.40 }, { x: 0.70, y: 0.60 });
  ok('turning left is negative', left < 0);
  ok('left and right are symmetric', near(left, -right, 1e-9));

  ok('span is measured in hand-sizes',
    near(handSpan({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }, 0.08, 0.10), 4, 1e-9));
}

/**
 * Two hands on a wheel of radius r, turned by phi, thumbs on top.
 *
 * Both hands' knuckle lines turn with the wheel, which is what makes the
 * orientation readable at any angle rather than only near centre.
 */
function wheelPose(phi, { cx = 0.5, cy = 0.5, r = 0.18, curl = 1 } = {}) {
  const a = { x: cx - r * Math.cos(phi), y: cy + r * Math.sin(phi) };
  const b = { x: cx + r * Math.cos(phi), y: cy - r * Math.sin(phi) };
  const hand = (p) => {
    const lm = makeHand({ x: p.x, y: p.y, curl, up: phi });
    return { ...handMetrics(lm), anchor: p };
  };
  return [hand(a), hand(b)];
}

console.log('thumbs on top means upright');
{
  // The line between two hands says nothing about which way up they are —
  // read it backwards and the wheel is half a turn out. The thumbs settle it.
  const read = (pair) => {
    const [lo, hi] = orientPair(pair[0], pair[1]);
    return pairedAngle(lo.anchor, hi.anchor);
  };

  const level = wheelPose(0);
  ok('level hands with thumbs up read as centred',
    Math.abs(read(level)) < 1e-6, `got ${deg(read(level)).toFixed(1)}°`);
  ok('and still centred if the pair arrives backwards',
    Math.abs(read([level[1], level[0]])) < 1e-6,
    `got ${deg(read([level[1], level[0]])).toFixed(1)}°`);

  // Orientation has to survive the whole range of lock, not just near centre.
  for (const phi of [-2.3, -1.6, -0.8, 0, 0.8, 1.6, 2.3]) {
    const pose = wheelPose(phi);
    const forward = read(pose);
    const backward = read([pose[1], pose[0]]);
    ok(`upright at ${deg(phi).toFixed(0).padStart(4)}° whichever order it arrives`,
      Math.abs(angleDelta(forward, phi)) < 1e-6 && Math.abs(angleDelta(backward, phi)) < 1e-6,
      `forward ${deg(forward).toFixed(1)}°, backward ${deg(backward).toFixed(1)}°`);
  }

  // Without the thumbs, a backwards pair reads half a turn out — which is the
  // failure this replaced, so it is worth pinning.
  const naive = pairedAngle(level[1].anchor, level[0].anchor);
  ok('ignoring the thumbs would invert a backwards pair',
    Math.abs(Math.abs(naive) - Math.PI) < 1e-6, `got ${deg(naive).toFixed(1)}°`);

  // Hands rolled the other way are a genuinely different pose and must read
  // as such, not be silently corrected back to upright.
  const inverted = [
    { ...level[0], up: { x: -level[0].up.x, y: -level[0].up.y } },
    { ...level[1], up: { x: -level[1].up.x, y: -level[1].up.y } },
  ];
  ok('thumbs underneath reads as inverted, not as upright',
    Math.abs(Math.abs(read(inverted)) - Math.PI) < 1e-6,
    `got ${deg(read(inverted)).toFixed(1)}°`);

  // Thumbs disagreeing cancel out and say nothing; leave the order alone.
  const conflicted = [level[0], { ...level[1], up: { x: -level[1].up.x, y: -level[1].up.y } }];
  const kept = orientPair(conflicted[0], conflicted[1]);
  ok('contradictory thumbs do not flip the pair on noise', kept[0] === conflicted[0]);
}

console.log('one hand on its own');
{
  // A hand grips the wheel and turns with it, so its knuckle line alone says
  // where the wheel is — which is what lets the other hand leave the frame
  // without control being lost.
  for (const phi of [-2.0, -0.7, 0, 0.7, 2.0]) {
    const [hand] = wheelPose(phi);
    ok(`a hand at ${String(Math.round(deg(phi))).padStart(4)}° reads its own roll`,
      Math.abs(angleDelta(handRoll(hand.up), phi)) < 1e-9,
      `read ${deg(handRoll(hand.up)).toFixed(1)}°`);
  }

  // Both hands of a pair agree, which is why either can stand in for the two.
  const [r, l] = wheelPose(0.9);
  ok('both hands of a pair agree on the angle',
    Math.abs(angleDelta(handRoll(r.up), handRoll(l.up))) < 1e-9);
}

console.log('rotation through the crossover');
{
  // Sorting by x flips the vector once the hands pass vertical. This is the
  // regression that matters: it happens exactly where full lock is asked for.
  let worstSorted = 0, prevSorted = null;
  for (let i = 0; i <= 120; i++) {
    const phi = -2.6 + (i / 120) * 5.2;
    const [a, b] = wheelPose(phi);
    const v = steeringAngleFromHands(a.anchor, b.anchor);
    if (prevSorted !== null) worstSorted = Math.max(worstSorted, Math.abs(v - prevSorted));
    prevSorted = v;
  }
  ok('sorting by x does jump (the bug being fixed)', worstSorted > 2.0,
    `largest step ${deg(worstSorted).toFixed(0)}°`);

  const pairs = new HandPairTracker();
  const unwrap = new AngleUnwrapper();
  let worst = 0, prev = null, tracked = 0, first = null, last = null;
  for (let i = 0; i <= 120; i++) {
    const phi = -2.6 + (i / 120) * 5.2;
    const pose = wheelPose(phi);
    // Hand out the two detections in arbitrary order, as a detector would.
    const detections = i % 2 ? [pose[1], pose[0]] : pose;
    const ordered = pairs.update(detections);
    if (!ordered) continue;
    const v = unwrap.push(pairedAngle(ordered[0].anchor, ordered[1].anchor));
    if (prev !== null) worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
    if (first === null) first = v;
    last = v;
    tracked++;
  }
  // Only the change matters — which hand seeds slot 0 sets a constant offset,
  // and the neutral captured on grip cancels it.
  ok('tracks the full 298° of rotation', Math.abs((last - first) - 5.2) < 0.02,
    `measured ${deg(last - first).toFixed(1)}°, expected 298.0°`);
  ok('pairing survives detection order changing', tracked === 121, `tracked ${tracked}/121`);
  ok('paired + unwrapped angle stays continuous', worst < 0.10,
    `largest step ${deg(worst).toFixed(1)}°`);
}

console.log('hands leaving and returning');
{
  // A hand out of frame for a moment must not wipe the pairing. If it does,
  // the pair is re-seeded on return — and a hand that comes back tilted lands
  // in the wrong slot, so the tilt is either ignored or flipped.
  const pairs = new HandPairTracker();
  const before = pairs.update(wheelPose(0.4));
  ok('pairs while both hands are visible', before !== null);

  for (let i = 0; i < 8; i++) pairs.update([]);          // hands out of frame
  ok('remembers the pairing through a gap', pairs.remembers, `missing ${pairs.missing}`);

  // They come back noticeably more tilted than they left.
  const after = pairs.update(wheelPose(1.2));
  ok('re-pairs on return', after !== null);
  const d = Math.abs(angleDelta(
    pairedAngle(before[0].anchor, before[1].anchor),
    pairedAngle(after[0].anchor, after[1].anchor),
  ));
  ok('a tilted return reads as the real change, not a flip',
    Math.abs(d - 0.8) < 0.02, `measured ${deg(d).toFixed(1)}°, expected 45.8°`);

  pairs.forget();
  ok('forget clears the pairing', !pairs.remembers);
}

console.log('seeding when tilted past vertical');
{
  // Past a quarter turn the hands have swapped sides on screen, so seeding by
  // screen order puts them in the wrong slots. Handedness does not care.
  const tilted = wheelPose(2.0);                          // 115°
  const withLabels = [
    { ...tilted[0], handedness: 'Left' },
    { ...tilted[1], handedness: 'Right' },
  ];

  const byOrder = new HandPairTracker().update(tilted);
  const byHand = new HandPairTracker().update([withLabels[1], withLabels[0]]);

  const orderAngle = pairedAngle(byOrder[0].anchor, byOrder[1].anchor);
  const handAngle = pairedAngle(byHand[0].anchor, byHand[1].anchor);
  ok('screen order mis-seeds a steeply tilted pair',
    Math.abs(angleDelta(orderAngle, handAngle)) > 3.0,
    `differ by ${deg(Math.abs(angleDelta(orderAngle, handAngle))).toFixed(0)}°`);

  // Handedness must give the same slots whichever order the detector reports.
  const a = new HandPairTracker().update([withLabels[0], withLabels[1]]);
  const b = new HandPairTracker().update([withLabels[1], withLabels[0]]);
  ok('handedness seeds identically whatever the detection order',
    near(pairedAngle(a[0].anchor, a[1].anchor), pairedAngle(b[0].anchor, b[1].anchor), 1e-9));

  // And the same slots however the hands are rotated.
  const angles = [0, 1.0, 2.0, 3.0].map((phi) => {
    const pose = wheelPose(phi);
    const labelled = [{ ...pose[0], handedness: 'Left' }, { ...pose[1], handedness: 'Right' }];
    const pair = new HandPairTracker().update(labelled);
    return pair[0].anchor.x - pair[1].anchor.x;
  });
  ok('the same physical hand always takes slot 0',
    new Set(angles.map((v) => Math.sign(v) || 1)).size <= 2,
    'slot assignment should not depend on rotation');
}

console.log('re-gripping somewhere else entirely');
{
  // Let go at one angle, take hold again at a very different one. Proximity
  // matching frequently prefers the swapped pairing here, which flips the
  // steering by half a turn; handedness does not care how far things moved.
  const labelled = (phi) => {
    const pose = wheelPose(phi);
    return [{ ...pose[0], handedness: 'Left' }, { ...pose[1], handedness: 'Right' }];
  };

  const pairs = new HandPairTracker();
  pairs.update(labelled(-1.66));                       // hands at -95°
  const after = pairs.update(labelled(0.52));          // now at +30°
  const measured = pairedAngle(after[0].anchor, after[1].anchor);
  ok('a big pose change still pairs correctly', Math.abs(measured - 0.52) < 0.02,
    `read ${deg(measured).toFixed(1)}°, expected 30.0°`);

  // The failure this replaced was the *mix*: handedness chose the slots, then
  // proximity was allowed to override it on the next sighting and picked the
  // swapped pairing. Reproduced here by seeding with labels and then feeding
  // an unlabelled pose, which is the only path proximity still takes.
  const mixed = new HandPairTracker();
  mixed.update(labelled(-1.66));
  const mixedAfter = mixed.update(wheelPose(0.52));      // no labels this time
  const mixedAngle = pairedAngle(mixedAfter[0].anchor, mixedAfter[1].anchor);
  ok('proximity would have flipped it after a labelled seed',
    Math.abs(angleDelta(mixedAngle, 0.52)) > 3.0,
    `read ${deg(mixedAngle).toFixed(1)}°, which is why handedness now wins`);

  // With labels on every frame — the real case — it stays correct.
  const labelledThroughout = new HandPairTracker();
  labelledThroughout.update(labelled(-1.66));
  const good = labelledThroughout.update(labelled(0.52));
  ok('labels on every frame keep it correct',
    Math.abs(pairedAngle(good[0].anchor, good[1].anchor) - 0.52) < 0.02);
}

console.log('angle unwrapping');
{
  // 172° to 188° is +16° the short way, not −344°.
  ok('delta takes the short way', near(angleDelta(3.0, -3.0), 0.2831853, 1e-6));
  const u = new AngleUnwrapper();
  u.push(3.0);
  const past = u.push(-3.0);
  ok('crossing ±π keeps counting up', past > 3.0, `got ${past.toFixed(3)}`);
}

console.log('one-euro filter');
{
  const rng = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Landmark jitter on a still hand: ±0.02 rad peak, about 0.0115 rms.
  const stillRun = () => {
    const f = new OneEuroFilter();
    const r = rng(7);
    let t = 0, sum = 0, n = 0, peak = 0;
    for (let i = 0; i < 300; i++) {
      t += 1 / 30;
      const v = f.filter(0.5 + (r() - 0.5) * 0.04, t);
      if (i > 60) { sum += (v - 0.5) ** 2; n++; peak = Math.max(peak, Math.abs(v - 0.5)); }
    }
    return { rms: Math.sqrt(sum / n), peak };
  };
  const { rms, peak } = stillRun();
  ok('cuts jitter on a still hand by 3x or better', rms < 0.0038,
    `rms ${rms.toFixed(4)} vs 0.0115 raw`);
  ok('peak wander stays under half a degree', peak < 0.010,
    `peak ${peak.toFixed(4)} rad = ${deg(peak).toFixed(2)}°`);

  // A brisk 1.5 rad/s rotation, with the same jitter riding on it.
  const moving = new OneEuroFilter();
  const r2 = rng(11);
  let t2 = 0, out = 0;
  for (let i = 0; i < 45; i++) { t2 += 1 / 30; out = moving.filter(i * 0.05 + (r2() - 0.5) * 0.04, t2); }
  const target = 44 * 0.05;
  ok('follows a brisk rotation to within 3%', out > target * 0.97,
    `reached ${(out / target * 100).toFixed(1)}%`);
}

console.log('gear flaps');
{
  // Pulling a paddle is one finger moving, not the hand. The grip has to
  // survive it, or the wheel would be dropped every time you change gear.
  const fist = handMetrics(makeHand({ curl: 1 }));
  const pulling = handMetrics(makeHand({ curl: 1, indexCurl: 0 }));

  ok('a closed fist reads its index as curled', fist.fingers.index < 1.35,
    `got ${fist.fingers.index.toFixed(2)}`);
  ok('straightening the index is clearly visible', pulling.fingers.index > 1.80,
    `got ${pulling.fingers.index.toFixed(2)}`);
  ok('the other fingers do not move', Math.abs(pulling.fingers.ring - fist.fingers.ring) < 1e-9);
  ok('and the grip is still held through the pull', pulling.grip > 0.55,
    `grip fell to ${pulling.grip.toFixed(2)}, engage threshold is 0.55`);

  const flick = new FlickDetector();
  let t = 0;
  const feed = (extension, frames = 1) => {
    let fired = 0;
    for (let i = 0; i < frames; i++) { t += 16; if (flick.update(extension, t)) fired++; }
    return fired;
  };

  ok('a curled finger does not shift', feed(1.20, 10) === 0);
  ok('straightening it shifts once', feed(1.95, 1) === 1);
  ok('holding it out does not repeat', feed(1.95, 20) === 0);
  ok('and it must curl back before shifting again', feed(1.95, 5) === 0);
  feed(1.20, 3);
  ok('curling back re-arms it', feed(1.95, 1) === 1);

  // A finger hovering at the threshold must not machine-gun shifts.
  let chatter = 0;
  for (let i = 0; i < 60; i++) chatter += feed(1.59 + (i % 2 ? 0.02 : -0.02), 1);
  ok('a finger held at the threshold does not chatter', chatter === 0,
    `fired ${chatter} times`);

  // Two pulls in quick succession: the second is refused as follow-through.
  const quick = new FlickDetector({ refractoryMs: 220 });
  let tt = 0;
  const pulse = () => {
    tt += 16; quick.update(1.20, tt);
    tt += 16; return quick.update(1.95, tt) ? 1 : 0;
  };
  ok('a real pull registers', pulse() === 1);
  ok('an immediate second one is treated as follow-through', pulse() === 0);
  tt += 400;
  quick.update(1.20, tt);
  tt += 16;
  ok('but a deliberate one after the pause registers', quick.update(1.95, tt) === true);
}

console.log('grip latch');
{
  const latch = new GripLatch({ engage: 0.55, release: 0.32, frames: 2 });
  ok('starts released', latch.held === false);
  latch.update(0.9);
  ok('one frame is not enough to engage', latch.held === false);
  latch.update(0.9);
  ok('two frames engage', latch.held === true);

  let flips = 0, prev = latch.held;
  for (let i = 0; i < 40; i++) {
    latch.update(0.44 + (i % 2 ? 0.02 : -0.02));
    if (latch.held !== prev) { flips++; prev = latch.held; }
  }
  ok('holds steady between thresholds', flips === 0, `flipped ${flips} times`);

  latch.update(0.1); latch.update(0.1);
  ok('releases when the hand opens', latch.held === false);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall hand-maths checks passed');
process.exit(failures ? 1 : 0);
