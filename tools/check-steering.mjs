/**
 * Tests for the camera steering source.
 *
 *   node tools/check-steering.mjs
 *
 * `HandTrackingSource` only needs an object with `running` and `latest`, so
 * the whole thing runs in plain Node against a stub tracker — no camera, no
 * model, no browser. This covers the behaviour that the pure geometry tests
 * cannot: what happens when hands vanish, when the detector stalls, when a
 * grip opens, and whether the wheel actually ends up where the hands are.
 */
import { HandTrackingSource } from '../src/input/handsource.js';
import { Shifter } from '../src/input/shifter.js';
import { handMetrics, LANDMARK } from '../src/vision/handmath.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const DEG = 180 / Math.PI;
const deg = (r) => r * DEG;

/** A hand in a wheel grip: knuckles on a line, `up` toward the thumb side. */
function makeHand(x, y, curl, up, indexCurl = null) {
  const lm = new Array(21);
  const u = { x: -Math.sin(up), y: -Math.cos(up) };
  const v = { x: -u.y, y: u.x };
  const size = 0.075, span = size * 0.78;
  const at = (a, c) => ({ x: x + u.x * a + v.x * c, y: y + u.y * a + v.y * c });
  lm[LANDMARK.INDEX_MCP] = at(span * 0.5, 0);
  lm[LANDMARK.MIDDLE_MCP] = at(span * 0.17, 0);
  lm[LANDMARK.RING_MCP] = at(-span * 0.17, 0);
  lm[LANDMARK.PINKY_MCP] = at(-span * 0.5, 0);
  lm[LANDMARK.WRIST] = at(0, -size * (1 - 0.1 * curl));
  const w = lm[LANDMARK.WRIST];
  const reach = size * (2.05 - curl * 0.9);
  const tip = (a) => ({ x: w.x + u.x * a + v.x * reach, y: w.y + u.y * a + v.y * reach });
  const iReach = size * (2.05 - (indexCurl ?? curl) * 0.90);
  lm[LANDMARK.INDEX_TIP] = {
    x: w.x + u.x * (span * 0.45) + v.x * iReach,
    y: w.y + u.y * (span * 0.45) + v.y * iReach,
  };
  lm[LANDMARK.MIDDLE_TIP] = tip(span * 0.15);
  lm[LANDMARK.RING_TIP] = tip(-span * 0.15);
  lm[LANDMARK.PINKY_TIP] = tip(-span * 0.45);
  lm[LANDMARK.THUMB_TIP] = at(span * 0.95, size * 0.35);
  for (let i = 0; i < 21; i++) if (!lm[i]) lm[i] = { ...w };
  return lm;
}

/**
 * A rig: stub tracker, a source, and a clock we control.
 *
 * Frames carry a synthetic timestamp that starts at the real clock and then
 * advances by `step` milliseconds each time, so a test can simulate seconds
 * of movement in microseconds of real time. It runs *ahead* of the real clock
 * on purpose — the source judges staleness against `performance.now()`, and a
 * frame stamped in the future is never stale. Stamping frames with the real
 * clock instead makes every movement look infinitely fast, because
 * consecutive frames land microseconds apart.
 */
function rig(options = {}) {
  const tracker = { running: true, latest: null, stop() { this.running = false; } };
  const source = new HandTrackingSource(tracker, options);
  let clock = performance.now();

  return {
    source,
    tracker,
    /** Publish a pose at angle `phi` and let the source read it. */
    frame(phi, { curl = 1, hands = 2, step = 20, pullRight = null, pullLeft = null } = {}) {
      clock += step;
      const cx = 0.5, cy = 0.5, r = 0.17;
      // The frame-left hand is the driver's right.
      const A = makeHand(cx - r * Math.cos(phi), cy + r * Math.sin(phi), curl, phi, pullRight);
      const B = makeHand(cx + r * Math.cos(phi), cy - r * Math.sin(phi), curl, phi, pullLeft);
      const all = [
        { landmarks: A, handedness: 'Left', ...handMetrics(A) },
        { landmarks: B, handedness: 'Right', ...handMetrics(B) },
      ];
      tracker.latest = { at: clock, hands: all.slice(0, hands) };
      return source.read();
    },
    /** Hold a pose for several frames, returning the last reading. */
    hold(n, phi, opts) {
      let last = null;
      for (let i = 0; i < n; i++) last = this.frame(phi, opts);
      return last;
    },
    /** Current synthetic time, for anything that needs to agree with it. */
    now() { return clock; },

    /** The detector produced nothing at all this frame. */
    silent() {
      return source.read();
    },
    /** Frames stopped arriving a while ago. */
    stall(ms = 400) {
      clock = performance.now() + ms;               // resume from "now" afterwards
      if (tracker.latest) tracker.latest = { ...tracker.latest, at: performance.now() - ms };
      return source.read();
    },
  };
}

console.log('the wheel matches the hands');
{
  const r = rig();
  r.hold(6, 0);
  ok('level hands centre the wheel', Math.abs(deg(r.source.angle)) < 0.5,
    `got ${deg(r.source.angle).toFixed(1)}°`);

  for (const angle of [0.7, -0.9, 1.6, -1.9]) {
    const r2 = rig();
    r2.hold(10, angle);
    ok(`hands at ${String(Math.round(deg(angle))).padStart(4)}° put the wheel there`,
      Math.abs(deg(r2.source.angle) - deg(angle)) < 2,
      `got ${deg(r2.source.angle).toFixed(1)}°`);
  }
}

console.log('gripping and letting go');
{
  const r = rig();
  ok('an open hand does not steer', r.hold(6, 0.8, { curl: 0 }) === null);
  const held = r.hold(6, 0.8, { curl: 1 });
  ok('closing both hands takes hold', held !== null && held.confidence > 0.8);
  ok('opening them again lets go', r.hold(6, 0.8, { curl: 0 }) === null);
}

console.log('hands leaving and returning');
{
  const r = rig();
  r.hold(8, 0.5);
  const before = r.source.angle;

  // Briefly gone: the wheel is held rather than dropped.
  const coasting = r.frame(0.5, { hands: 0 });
  ok('a momentary loss keeps hold of the wheel',
    coasting !== null && Math.abs(r.source.angle - before) < 1e-9);
  ok('and says so', r.source.state.coasting === true, r.source.state.reason);

  // Out of frame long enough that the accumulated angle is no longer
  // trustworthy, but not so long that the grip is given up.
  r.hold(14, 0.5, { hands: 0 });

  // Back at a very different angle. The placement happens on the first frame
  // it is seen again, so that is the one to inspect.
  const firstBack = r.frame(-1.2);
  ok('a tilted return is matched on the very first frame',
    Math.abs(deg(firstBack.angle) - deg(-1.2)) < 2,
    `got ${deg(firstBack.angle).toFixed(1)}°, expected ${deg(-1.2).toFixed(1)}°`);
  ok('and asks for the wheel to be placed, not sprung to', firstBack.snap === true);

  r.hold(6, -1.2);
  ok('and it stays there', Math.abs(deg(r.source.angle) - deg(-1.2)) < 2,
    `got ${deg(r.source.angle).toFixed(1)}°`);
}

console.log('the detector stalling');
{
  // The regression this file was written for. When frames stop arriving the
  // source used to return early without releasing its accumulated angle, and
  // on resume it carried a stale reading — the wheel stuck at an angle the
  // hands were nowhere near, and no amount of moving them fixed it.
  const r = rig({ graceMs: 0 });
  r.hold(8, 1.4);
  ok('tracking a held pose', Math.abs(deg(r.source.angle) - deg(1.4)) < 2);

  r.stall(400);
  r.silent();                                       // one more read past the grace
  ok('a stalled detector lets go', r.source.state.holding === false, r.source.state.reason);

  const resumed = r.frame(-0.6);
  ok('and resuming re-reads the angle rather than continuing the old one',
    Math.abs(deg(resumed.angle) - deg(-0.6)) < 2,
    `got ${deg(resumed.angle).toFixed(1)}°, expected ${deg(-0.6).toFixed(1)}°`);
  ok('placing the wheel outright on resume', resumed.snap === true);
}

console.log('fast movement');
{
  // A limit set near human speed rejects real driving. A hard correction
  // passes 700°/s, so nothing in that range may be discarded as a glitch.
  const r = rig();
  r.hold(6, 0);
  let rejected = 0;
  const rate = 12;                                   // rad/s ≈ 688°/s
  const amp = 1.2;
  for (let i = 1; i <= 40; i++) {
    r.frame(amp * Math.sin((rate / amp) * i * 0.02));
    if (r.source.state.reason.includes('glitch')) rejected++;
  }
  ok('a 688°/s sweep is not dismissed as a glitch', rejected === 0,
    `${rejected} frames rejected`);

  const held = r.source.state.holding;
  ok('and the wheel is still being held afterwards', held === true);
}

console.log('velocity for the controller to lead on');
{
  const r = rig();
  r.hold(4, 0);
  let last = null;
  for (let i = 1; i <= 25; i++) last = r.frame(i * 0.08);   // 4 rad/s at 20 ms steps
  ok('reports roughly the true angular velocity',
    last !== null && Math.abs(last.velocity - 4) < 1.2,
    `reported ${last?.velocity?.toFixed(2)}, expected ~4`);
  // Nothing sensible can be said about velocity across a gap, so none is
  // offered — the controller would otherwise lead on a stale number.
  r.hold(14, 0.5, { hands: 0 });
  const afterGap = r.frame(0.5);
  ok('and offers no velocity on the frame it re-acquires', afterGap.velocity === 0);
}

console.log('rejecting what it cannot measure');
{
  const r = rig();
  ok('one hand is not enough', r.hold(6, 0.5, { hands: 1 }) === null,
    r.source.state.reason);

  // Hands almost touching: the angle between them is too noisy to steer with.
  const r2 = rig();
  const A = makeHand(0.488, 0.5, 1, 0);
  const B = makeHand(0.512, 0.5, 1, 0);
  let closeReading = null;
  for (let i = 0; i < 6; i++) {
    r2.tracker.latest = { at: performance.now() + 1000 + i * 20, hands: [
      { landmarks: A, handedness: 'Left', ...handMetrics(A) },
      { landmarks: B, handedness: 'Right', ...handMetrics(B) }] };
    closeReading = r2.source.read();
  }
  ok('hands too close together are refused',
    closeReading === null && r2.source.state.reason.includes('apart'),
    r2.source.state.reason);
}

console.log('carrying on with one hand');
{
  // Reaching the edge of frame with one hand should not cost you the wheel.
  const r = rig();
  r.hold(12, 0.5);
  const both = r.source.angle;
  ok('two hands are tracking', Math.abs(deg(both) - deg(0.5)) < 2);

  const alone = r.hold(6, 0.5, { hands: 1 });
  ok('one hand keeps hold of the wheel', alone !== null, r.source.state.reason);
  ok('and says the accuracy is reduced', r.source.state.single === true);
  ok('without jumping when the other left',
    Math.abs(deg(r.source.angle) - deg(0.5)) < 3,
    `moved to ${deg(r.source.angle).toFixed(1)}° from ${deg(both).toFixed(1)}°`);
  ok('at lower confidence than a pair', alone.confidence < 0.65,
    `confidence ${alone.confidence.toFixed(2)}`);

  // And it still steers, not merely holds.
  r.hold(10, 1.1, { hands: 1 });
  ok('a single hand still steers',
    Math.abs(deg(r.source.angle) - deg(1.1)) < 4,
    `got ${deg(r.source.angle).toFixed(1)}°, expected ${deg(1.1).toFixed(1)}°`);

  // Opening that hand is still letting go.
  ok('opening the lone hand lets go', r.hold(6, 1.1, { hands: 1, curl: 0 }) === null);

  // Without ever having seen a pair there is no calibration to lean on, so a
  // lone hand is refused rather than guessed at.
  const cold = rig();
  ok('a lone hand with no pairing behind it is refused',
    cold.hold(8, 0.5, { hands: 1 }) === null, cold.source.state.reason);
}

console.log('gear flaps');
{
  const r = rig();
  const shifts = [];
  const shifter = new Shifter(r.source, { onShift: (d) => shifts.push(d) });
  const step = (opts) => { r.frame(0.2, opts); shifter.update(r.now()); };

  // Hands open: a waved finger must not be able to change gear.
  for (let i = 0; i < 6; i++) step({ curl: 0, pullRight: 0 });
  ok('a finger does nothing while the wheel is not held', shifts.length === 0);

  // Take hold.
  for (let i = 0; i < 6; i++) step({ curl: 1, pullRight: 1, pullLeft: 1 });
  ok('holding the wheel arms the flaps', shifter.state.armed === true);
  ok('and holding it alone shifts nothing', shifts.length === 0);

  // Right hand pulls: upshift.
  step({ curl: 1, pullRight: 0, pullLeft: 1 });
  ok('a right-hand pull is an upshift', shifts.length === 1 && shifts[0] === 1,
    JSON.stringify(shifts));
  ok('and the wheel is still held through it', r.source.state.holding === true);

  for (let i = 0; i < 8; i++) step({ curl: 1, pullRight: 0, pullLeft: 1 });
  ok('holding the finger out does not repeat it', shifts.length === 1,
    `${shifts.length} shifts`);

  // Curl back, then the left hand pulls: downshift.
  for (let i = 0; i < 4; i++) step({ curl: 1, pullRight: 1, pullLeft: 1 });
  for (let i = 0; i < 20; i++) step({ curl: 1, pullRight: 1, pullLeft: 1 });
  step({ curl: 1, pullRight: 1, pullLeft: 0 });
  ok('a left-hand pull is a downshift', shifts.length === 2 && shifts[1] === -1,
    JSON.stringify(shifts));

  // Letting go of the wheel disarms them.
  for (let i = 0; i < 6; i++) step({ curl: 0, pullRight: 0 });
  ok('letting go disarms the flaps', shifter.state.armed === false);
  const before = shifts.length;
  for (let i = 0; i < 6; i++) step({ curl: 0, pullRight: 0, pullLeft: 0 });
  ok('and no further shifts get through', shifts.length === before);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall steering checks passed');
process.exit(failures ? 1 : 0);
