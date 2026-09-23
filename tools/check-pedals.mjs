/**
 * Tests for the pedals.
 *
 *   node tools/check-pedals.mjs
 *
 * Synthesises pose landmarks and a fake foot tracker rather than needing a
 * second camera, so the pedal mapping, the calibration, what happens when a
 * foot leaves frame, and the car's response to being driven can all be
 * checked directly.
 */
import { footMetrics, PedalCalibrator, POSE } from '../src/vision/footmath.js';
import { PedalSource } from '../src/input/pedalsource.js';
import { resolveAssignment } from '../src/vision/devices.js';
import { CarSim } from '../src/sim/carsim.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const deg = (r) => (r * 180) / Math.PI;

/**
 * A synthetic foot.
 *
 * The heel is planted and the toe swings about it, which is how a foot on a
 * pedal actually moves. `pitchDeg` is positive with the toe raised above the
 * heel — the foot lifted off the pedal — and negative with it pressed down.
 */
function makeFoot(side, pitchDeg, { visibility = 0.95, length = 0.12, heel = { x: 0.4, y: 0.7 } } = {}) {
  const lm = [];
  const a = (pitchDeg * Math.PI) / 180;
  const idx = side === 'left'
    ? { ankle: POSE.LEFT_ANKLE, heel: POSE.LEFT_HEEL, toe: POSE.LEFT_TOE }
    : { ankle: POSE.RIGHT_ANKLE, heel: POSE.RIGHT_HEEL, toe: POSE.RIGHT_TOE };
  lm[idx.heel] = { ...heel, visibility };
  lm[idx.toe] = { x: heel.x + length * Math.cos(a), y: heel.y - length * Math.sin(a), visibility };
  lm[idx.ankle] = { x: heel.x, y: heel.y - length * 0.5, visibility };
  return lm;
}

console.log('\nfoot geometry');
{
  const flat = footMetrics(makeFoot('right', 0), 'right');
  ok('a flat foot reads level', near(flat.pitch, 0, 1e-9), `${deg(flat.pitch).toFixed(2)}°`);

  const up = footMetrics(makeFoot('right', 20), 'right');
  ok('a raised toe reads positive', up.pitch > 0 && near(deg(up.pitch), 20, 1e-6), `${deg(up.pitch).toFixed(2)}°`);

  const down = footMetrics(makeFoot('right', -25), 'right');
  ok('a pressed toe reads negative', down.pitch < 0 && near(deg(down.pitch), -25, 1e-6), `${deg(down.pitch).toFixed(2)}°`);

  // The whole reason pitch is the signal rather than the toe's height.
  const near_ = footMetrics(makeFoot('right', -25, { length: 0.30, heel: { x: 0.1, y: 0.2 } }), 'right');
  ok('pitch does not change when the foot moves in frame',
    near(down.pitch, near_.pitch, 1e-9), `${deg(down.pitch).toFixed(2)}° vs ${deg(near_.pitch).toFixed(2)}°`);

  const half = footMetrics(makeFoot('left', 0, { visibility: 0.3 }), 'left');
  ok('visibility is carried through', near(half.visibility, 0.3), `${half.visibility}`);
  ok('the two feet are read separately', footMetrics(makeFoot('left', 10), 'right') === null
    || footMetrics(makeFoot('left', 10), 'right').pitch === 0);
}

console.log('\npedal calibration');
{
  const cal = new PedalCalibrator();
  let t = 0;
  const feed = (pitchDeg, seconds = 0.5) => {
    let v = 0;
    for (let i = 0; i < Math.round(seconds * 60); i++) { t += 1 / 60; v = cal.update((pitchDeg * Math.PI) / 180, t); }
    return v;
  };

  feed(8, 1.0);                                  // sit still with the foot at rest
  ok('a resting foot reads zero', cal.value < 0.02, cal.value.toFixed(3));

  const pressed = feed(-14, 0.8);
  ok('pressing down opens the pedal', pressed > 0.8, pressed.toFixed(3));

  const released = feed(8, 0.8);
  ok('lifting closes it again', released < 0.02, released.toFixed(3));

  // A driver who presses further should still get a full pedal, not a pedal
  // that saturates early and stays there.
  const deeper = feed(-40, 0.8);
  ok('a deeper press still tops out at 1', near(deeper, 1, 1e-9), deeper.toFixed(3));
  const backToNormal = feed(8, 1.0);
  ok('and the zero survives it', backToNormal < 0.02, backToNormal.toFixed(3));

  // Rest must not drift down while a pedal is held, or the car would quietly
  // come off the power during a long corner.
  const cal2 = new PedalCalibrator();
  let t2 = 0;
  for (let i = 0; i < 60; i++) { t2 += 1 / 60; cal2.update((8 * Math.PI) / 180, t2); }
  let held = 0;
  for (let i = 0; i < 60 * 10; i++) { t2 += 1 / 60; held = cal2.update((-14 * Math.PI) / 180, t2); }
  ok('a pedal held for ten seconds does not bleed off', held > 0.75, held.toFixed(3));
}

console.log('\nthrottle and brake');
{
  const tracker = { latest: null, running: true };
  const pedals = new PedalSource({ tracker });
  const dt = 1 / 60;
  const post = (rightDeg, leftDeg, opts = {}) => {
    tracker.latest = {
      right: rightDeg === null ? null : footMetrics(makeFoot('right', rightDeg, opts), 'right'),
      left: leftDeg === null ? null : footMetrics(makeFoot('left', leftDeg, opts), 'left'),
      at: performance.now(), captureAt: performance.now(),
    };
  };
  const run = (seconds) => { let r; for (let i = 0; i < seconds * 60; i++) r = pedals.read(dt); return r; };

  post(8, 8); run(1);
  ok('both feet at rest give nothing', pedals.throttle < 0.02 && pedals.brake < 0.02,
    `t=${pedals.throttle.toFixed(2)} b=${pedals.brake.toFixed(2)}`);

  post(-14, 8); run(0.8);
  ok('the right foot is the throttle', pedals.throttle > 0.8, pedals.throttle.toFixed(2));
  ok('and it leaves the brake alone', pedals.brake < 0.02, pedals.brake.toFixed(2));

  post(8, -14); run(0.8);
  ok('the left foot is the brake', pedals.brake > 0.8, pedals.brake.toFixed(2));
  ok('and it closes the throttle', pedals.throttle < 0.02, pedals.throttle.toFixed(2));

  // Both at once — trail braking, and a driver resting a foot on the brake.
  post(-14, -14); run(0.8);
  ok('both pedals can be down together', pedals.throttle > 0.8 && pedals.brake > 0.8,
    `t=${pedals.throttle.toFixed(2)} b=${pedals.brake.toFixed(2)}`);

  // A foot leaving frame must close the throttle, and must not do it instantly.
  post(-14, 8); run(0.8);
  const before = pedals.throttle;
  post(null, 8);
  const afterOneFrame = pedals.read(dt).throttle;
  ok('one dropped frame barely moves the throttle', before - afterOneFrame < 0.05,
    `${before.toFixed(2)} → ${afterOneFrame.toFixed(2)}`);
  run(0.4);
  ok('a foot gone for good closes the throttle', pedals.throttle === 0, pedals.throttle.toFixed(3));
  ok('and the panel knows it is not seeing it', pedals.state.throttle.seen === false);

  // An unbelievable reading is the same as no reading.
  post(-14, -14, { visibility: 0.2 }); run(0.5);
  ok('a foot the model is unsure about is not trusted',
    pedals.throttle === 0 && pedals.brake === 0);

  // One foot out of frame must not take the other with it.
  post(8, 8); run(1); post(-14, null); run(0.8);
  ok('losing the brake foot leaves the throttle working', pedals.throttle > 0.8, pedals.throttle.toFixed(2));
}

console.log('\ncamera assignment');
{
  const two = [{ deviceId: 'A' }, { deviceId: 'B' }];
  const same = (g, w) => JSON.stringify(g) === JSON.stringify(w);
  ok('hands take the first camera, feet the second', same(resolveAssignment(two), { hands: 'A', feet: 'B' }));
  ok('a stored choice is honoured', same(resolveAssignment(two, { hands: 'B', feet: 'A' }), { hands: 'B', feet: 'A' }));
  ok('a camera that has been unplugged falls back',
    same(resolveAssignment(two, { hands: 'Z', feet: 'B' }), { hands: 'A', feet: 'B' }));
  ok('one camera is never given both jobs',
    same(resolveAssignment(two, { hands: 'A', feet: 'A' }), { hands: 'A', feet: 'B' }));
  ok('with one camera, hands win and feet go without',
    same(resolveAssignment([{ deviceId: 'A' }]), { hands: 'A', feet: null }));
}

console.log('\ndriving the car');
{
  const dt = 1 / 60;
  const drive = (pedals, seconds, start = 0, steer = 0) => {
    const c = new CarSim();
    c.speed = start;
    for (let i = 0; i < seconds * 60; i++) c.update(dt, steer, pedals);
    return c;
  };

  const flat = drive({ throttle: 1, brake: 0 }, 6);
  ok('full throttle accelerates', flat.speed > 150, `${flat.speed.toFixed(0)} km/h`);
  ok('and says it is being driven', flat.driven === true);

  const stopped = drive({ throttle: 0, brake: 1 }, 3, 250);
  ok('the brake stops the car', stopped.speed < 1, `${stopped.speed.toFixed(1)} km/h`);

  const coast = drive({ throttle: 0, brake: 0 }, 1, 200);
  ok('lifting off coasts rather than stopping dead',
    coast.speed < 200 && coast.speed > 180, `${coast.speed.toFixed(0)} km/h`);

  const braking = drive({ throttle: 0, brake: 1 }, 0.5, 250).speed;
  const lifting = drive({ throttle: 0, brake: 0 }, 0.5, 250).speed;
  ok('the brake is far stronger than lifting off', lifting - braking > 40,
    `${(lifting - braking).toFixed(0)} km/h difference in half a second`);

  const held = drive({ throttle: 1, brake: 1 }, 4, 200);
  ok('brake beats throttle when both are down', held.speed < 60, `${held.speed.toFixed(0)} km/h`);

  const corner = drive({ throttle: 1, brake: 0 }, 5, 300, 1);
  ok('cornering still scrubs speed off', corner.speed < 180, `${corner.speed.toFixed(0)} km/h`);

  // The single-camera rig must keep working exactly as it did.
  const legacy = new CarSim();
  for (let i = 0; i < 60 * 20; i++) legacy.update(dt, 0);
  ok('with no pedals the car still drives itself', legacy.speed > 250, `${legacy.speed.toFixed(0)} km/h`);
  ok('and reports that it is not being driven', legacy.driven === false);

  const t = drive({ throttle: 0.5, brake: 0 }, 3).telemetry;
  ok('telemetry carries the pedals', near(t.throttle, 0.5) && t.brake === 0 && t.driven === true);
}

console.log(failures === 0 ? '\nall pedal checks passed\n' : `\n${failures} pedal check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
