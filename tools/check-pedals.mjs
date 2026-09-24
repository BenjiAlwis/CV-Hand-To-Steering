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
import { footMetrics, PedalCalibrator, POSE, framingAdvice, silhouettePitch } from '../src/vision/footmath.js';
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

// Measured against a real foot camera: a foot that is plainly in shot scores
// around 0.6-0.8, not the 0.9+ a full-body pose gives, while a foot the model
// is merely extrapolating scores under 0.25. The gate has to sit between those
// two bands, and it used to sit on top of the lower edge of the upper one.
console.log('\nsurviving a bad landmark');
{
  const cal = new PedalCalibrator();
  let t = 0;
  const feed = (pitchDeg, seconds = 0.5) => {
    let v = 0;
    for (let i = 0; i < Math.round(seconds * 60); i++) { t += 1 / 60; v = cal.update((pitchDeg * Math.PI) / 180, t); }
    return v;
  };
  feed(8, 1.0);
  feed(-14, 0.8);
  feed(8, 0.6);

  // A half-occluded foot throws a landmark across the frame for a frame or two.
  t += 1 / 60;
  cal.update((-130 * Math.PI) / 180, t);
  ok('an absurd reading cannot stretch travel past the cap',
    cal.travel <= cal.maxTravel + 1e-9, cal.travel.toFixed(2));

  feed(8, 1.0);
  const after = feed(-14, 0.8);
  ok('and a normal press still opens the pedal afterwards', after > 0.4, after.toFixed(2));

  feed(8, 3.0);
  ok('travel eases back toward the default when it is not needed',
    cal.travel < 0.66, cal.travel.toFixed(3));
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

  // An unbelievable reading is the same as no reading. The two bands either
  // side of the gate are measured, not invented: feet plainly in shot came
  // back at 0.63-0.82, feet merely extrapolated at 0.11-0.24.
  post(-14, -14, { visibility: 0.2 }); run(0.5);
  ok('a foot the model is only extrapolating is not trusted',
    pedals.throttle === 0 && pedals.brake === 0);

  post(8, 8, { visibility: 0.62 }); run(1);
  post(-14, 8, { visibility: 0.62 }); run(0.8);
  ok('a foot plainly in shot at 0.62 is trusted', pedals.throttle > 0.8, pedals.throttle.toFixed(2));

  // A landmark that jumps across the frame is not a foot that moved.
  post(8, 8); run(1);
  const steady = pedals.throttle;
  post(-130, 8);                       // one impossible frame
  const spiked = pedals.read(dt).throttle;
  ok('an impossible jump is ignored rather than driven',
    Math.abs(spiked - steady) < 0.05, `${steady.toFixed(2)} → ${spiked.toFixed(2)}`);
  ok('and it is counted as rejected', pedals.state.throttle.rejected > 0);

  post(-14, 8); run(0.8);
  ok('a real press still gets through after a rejected one', pedals.throttle > 0.7,
    pedals.throttle.toFixed(2));

  // Marginal framing: the band a close foot camera actually produces.
  post(8, 8, { visibility: 0.34 }); run(1);
  post(-14, 8, { visibility: 0.34 }); run(0.8);
  ok('a foot at 0.34 visibility still steers the pedal', pedals.throttle > 0.7,
    pedals.throttle.toFixed(2));

  // One foot out of frame must not take the other with it.
  post(8, 8); run(1); post(-14, null); run(0.8);
  ok('losing the brake foot leaves the throttle working', pedals.throttle > 0.8, pedals.throttle.toFixed(2));
}

console.log('\nframing advice');
{
  // A foot at (x, y) reaching `len` to the right, as the landmarks come back.
  const foot = (x, y, len, visibility) => ({
    ankle: { x, y: y - len * 0.4 }, heel: { x, y }, toe: { x: x + len, y },
    length: len, visibility, pitch: 0,
  });
  const good = () => ({ sawPerson: true, left: foot(0.30, 0.55, 0.12, 0.8), right: foot(0.58, 0.55, 0.12, 0.8) });
  const code = (o) => framingAdvice(o).code;

  ok('nothing found at all asks for more of you in shot',
    code({ sawPerson: false }) === 'no-person');
  ok('found without feet asks for the camera to come down',
    code({ sawPerson: true, left: foot(0.3, 0.5, 0.1, 0.1), right: foot(0.6, 0.5, 0.1, 0.1) }) === 'no-feet');
  ok('one foot missing is called out on its own',
    code({ ...good(), right: foot(0.58, 0.55, 0.12, 0.05) }) === 'one-foot');
  ok('and it names the pedal that has nothing to read',
    /brake/.test(framingAdvice({ ...good(), left: foot(0.3, 0.55, 0.12, 0.05) }).message));

  ok('a foot filling the frame is told to move back, not to centre up',
    code({ ...good(), left: foot(0.05, 0.5, 0.45, 0.8), right: foot(0.5, 0.5, 0.45, 0.8) }) === 'too-close');
  ok('a foot against the edge is told to leave room',
    code({ ...good(), left: foot(0.01, 0.55, 0.12, 0.8) }) === 'at-edge');
  ok('feet pointing at the lens are told to move it aside',
    code({ sawPerson: true, left: foot(0.3, 0.5, 0.02, 0.8), right: foot(0.6, 0.5, 0.02, 0.8) }) === 'end-on');
  ok('a good picture is left alone', framingAdvice(good()).ok === true);

  // The order matters as much as the checks: advice that cannot be acted on
  // until something else is fixed must not come first.
  ok('missing feet outrank edges', code({ sawPerson: true,
    left: foot(0.01, 0.5, 0.12, 0.05), right: foot(0.6, 0.5, 0.12, 0.05) }) === 'no-feet');
  ok('no person outranks everything', code({ sawPerson: false, left: foot(0.3, 0.5, 0.45, 0.9) }) === 'no-person');
}

console.log('\nfalling back to the silhouette');
{
  const blob = (y0, y1, cy) => ({ y0, y1, cy, x0: 0.3, x1: 0.5, side: 'right', confidence: 0.8 });

  ok('a level foot reads zero', Math.abs(silhouettePitch(blob(0.2, 0.8, 0.5))) < 1e-9);
  ok('mass high reads as lifted', silhouettePitch(blob(0.2, 0.8, 0.35)) > 0);
  ok('mass low reads as pressed', silhouettePitch(blob(0.2, 0.8, 0.65)) < 0);
  // The reason it is a fraction of the region's own height, and not the
  // centroid's position in the frame: neither how big the foot is nor where
  // it sits should change the pedal.
  ok('it does not care how big the foot is in frame',
    Math.abs(silhouettePitch(blob(0.0, 0.3, 0.075)) - silhouettePitch(blob(0.4, 1.0, 0.55))) < 1e-9);
  ok('a region too flat to read is refused', silhouettePitch(blob(0.5, 0.51, 0.505)) === null);
  ok('and so is nothing at all', silhouettePitch(null) === null);

  // The pose graph wins when it has an answer; the silhouette covers when it
  // does not, which on a camera close to the floor is most of the time.
  const tracker = { latest: null, boxes: [], running: true };
  const pedals = new PedalSource({ tracker });
  const dt = 1 / 60;
  const run = (seconds) => { for (let i = 0; i < seconds * 60; i++) pedals.read(dt); };

  const postPose = (deg) => {
    tracker.latest = {
      right: footMetrics(makeFoot('right', deg), 'right'),
      left: footMetrics(makeFoot('left', deg), 'left'),
      at: performance.now(), captureAt: performance.now(),
    };
  };
  const postBoxes = (cy) => {
    tracker.boxes = [
      { ...blob(0.2, 0.8, cy), side: 'right' },
      { ...blob(0.2, 0.8, cy), side: 'left' },
    ];
  };

  postPose(8); postBoxes(0.5); run(1);
  ok('with both available the joints are used', pedals.state.throttle.from === 'pose');

  // Pose goes away, as it does the moment the camera cannot see a person.
  tracker.latest = { right: null, left: null, at: performance.now(), captureAt: performance.now() };
  postBoxes(0.35); run(1);
  ok('without joints it falls back to the shape', pedals.state.throttle.from === 'silhouette');
  ok('and reads the lifted foot as off the pedal', pedals.throttle < 0.05,
    pedals.throttle.toFixed(2));

  postBoxes(0.66); run(0.8);
  ok('pressing down opens the pedal through the fallback', pedals.throttle > 0.7,
    pedals.throttle.toFixed(2));

  // And with neither, it closes rather than holding the last reading.
  tracker.boxes = [];
  run(0.6);
  ok('with nothing at all the pedal closes', pedals.throttle === 0);
  ok('and it says it has no source', pedals.state.throttle.from === null);
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
  // A car placed at a speed has to be placed in a gear that will hold it.
  // Before the ratios meant anything this did not matter and every test
  // started in first; now 200 km/h in first is an over-revving engine being
  // dragged back, which is correct and made a coasting test fail.
  const TOPS = [78, 118, 158, 196, 232, 267, 298, 330];
  const drive = (pedals, seconds, start = 0, steer = 0) => {
    const c = new CarSim();
    c.speed = start;
    c.gear = Math.max(1, TOPS.findIndex((top) => top >= start) + 1) || TOPS.length;
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

console.log('\nthe gearbox');
{
  const dt = 1 / 60;
  // The ratios the sim ships with. A gear cannot pull past its own top speed.
  const TOPS = [78, 118, 158, 196, 232, 267, 298, 330];

  /** Full throttle, with the driver holding one gear the way a paddle does. */
  const held = (gear, seconds = 30) => {
    const c = new CarSim();
    for (let i = 0; i < seconds * 60; i++) {
      while (c.gear < gear) c.shift(1);
      c._manualHold = 3;
      c.update(dt, 0, { throttle: 1, brake: 0 });
    }
    return c;
  };

  // The bug this is all for: first gear held flat reached 286 km/h against a
  // ratio good for 78, because power was never limited by the gear at all.
  const first = held(1);
  ok('first gear cannot be driven past its ratio', first.speed <= TOPS[0] + 1,
    `${first.speed.toFixed(0)} km/h vs ${TOPS[0]}`);
  ok('and it does get there', first.speed > TOPS[0] * 0.95, `${first.speed.toFixed(0)} km/h`);

  let allHeld = true, worst = '';
  for (let g = 1; g <= 6; g++) {
    const c = held(g, 25);
    if (c.speed > TOPS[g - 1] + 1) { allHeld = false; worst = `gear ${g}: ${c.speed.toFixed(0)} > ${TOPS[g - 1]}`; }
  }
  ok('every gear holds its own ceiling', allHeld, worst);

  // The automatic box has to climb the whole way, and settle.
  const auto = new CarSim();
  const gears = new Set();
  for (let i = 0; i < 90 * 60; i++) { auto.update(dt, 0, { throttle: 1, brake: 0 }); gears.add(auto.gear); }
  ok('the box climbs through all eight gears', gears.size === 8, `${gears.size} gears used`);
  ok('and reaches a sensible top speed', auto.speed > 290 && auto.speed <= 330,
    `${auto.speed.toFixed(0)} km/h`);
  ok('in top gear', auto.gear === 8, `gear ${auto.gear}`);

  // Hunting: upshifting at one threshold and downshifting at another that
  // overlaps it makes the box oscillate, which it did — six to seven and back.
  const cruise = new CarSim();
  cruise.speed = 200; cruise.gear = 5;
  let shifts = 0;
  for (let i = 0; i < 30 * 60; i++) {
    const was = cruise.gear;
    cruise.update(dt, 0, { throttle: 0.42, brake: 0 });
    if (cruise.gear !== was) shifts++;
  }
  ok('a steady cruise does not make it hunt', shifts <= 2, `${shifts} shifts in 30s`);

  // Slowing down must walk back down the box, once each.
  const slowing = new CarSim();
  slowing.speed = 300; slowing.gear = 8;
  const down = [];
  for (let i = 0; i < 25 * 60; i++) {
    const was = slowing.gear;
    slowing.update(dt, 0, { throttle: 0, brake: 0.3 });
    if (slowing.gear !== was) down.push(slowing.gear);
  }
  ok('slowing walks back down the box', down.join() === '7,6,5,4,3,2,1', down.join(' '));

  // A downshift the gear cannot hold is refused, as a real box refuses it.
  const fast = new CarSim();
  fast.speed = 300; fast.gear = 8;
  ok('8th to 7th at 300 is allowed', fast.shift(-1) === true);
  ok('but it will not drop further than the speed allows',
    fast.shift(-1) === false && fast.gear === 7, `gear ${fast.gear}`);

  const spam = new CarSim();
  spam.speed = 300; spam.gear = 8;
  for (let i = 0; i < 8; i++) spam.shift(-1);
  ok('spamming the downshift paddle cannot reach first at 300 km/h',
    spam.gear >= 7, `gear ${spam.gear}`);

  const low = new CarSim();
  low.speed = 60; low.gear = 3;
  ok('a downshift the gear can hold still works', low.shift(-1) === true && low.gear === 2);

  // Over-revving: dropped into a gear a little too low, the engine holds back.
  // Held there, so the box cannot rescue it by taking the next gear up —
  // without the hold this passed for the wrong reason, the car simply
  // upshifting and carrying on.
  const overRev = new CarSim();
  overRev.speed = 125; overRev.gear = 2;
  const before = overRev.speed;
  for (let i = 0; i < 60; i++) { overRev._manualHold = 3; overRev.update(dt, 0, { throttle: 1, brake: 0 }); }
  ok('over the gear\'s limit the engine drags the car back, throttle or not',
    overRev.speed < before - 2 && overRev.gear === 2,
    `${before} → ${overRev.speed.toFixed(0)} in gear ${overRev.gear}`);
  ok('and it settles at what the gear will hold',
    Math.abs(overRev.speed - TOPS[1]) < 8, `${overRev.speed.toFixed(0)} vs ${TOPS[1]}`);

  // And the self-driving car must respect gearing too.
  const legacy = new CarSim();
  legacy.gear = 1; legacy._manualHold = 999;
  for (let i = 0; i < 20 * 60; i++) { legacy._manualHold = 999; legacy.update(dt, 0); }
  ok('the self-driving car is bound by its gear as well', legacy.speed <= TOPS[0] + 1,
    `${legacy.speed.toFixed(0)} km/h in first`);
}

console.log(failures === 0 ? '\nall pedal checks passed\n' : `\n${failures} pedal check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
