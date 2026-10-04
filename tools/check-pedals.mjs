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
import { CarSim, brakeTempFactor, NEUTRAL, REVERSE } from '../src/sim/carsim.js';

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
  // These are about the pedals, so the gearbox is left to the automatic box.
  const drive = (pedals, seconds, start = 0, steer = 0) => {
    const c = new CarSim();
    c.assists.gears = true;
    c.speed = start;
    c.gear = Math.max(1, TOPS.findIndex((top) => top >= start) + 1) || TOPS.length;
    for (let i = 0; i < seconds * 60; i++) c.update(dt, steer, pedals);
    return c;
  };

  const flat = drive({ throttle: 1, brake: 0 }, 6);
  ok('full throttle accelerates', flat.speed > 150, `${flat.speed.toFixed(0)} km/h`);
  ok('and says it is being driven', flat.driven === true);

  // Braking at the limit — ABS standing in for a perfect left foot.
  const atLimit = (() => {
    const c = new CarSim(); c.assists.gears = true; c.assists.abs = true; c.speed = 250; c.gear = 7;
    for (let i = 0; i < 3 * 60; i++) c.update(dt, 0, { throttle: 0, brake: 1 });
    return c;
  })();
  ok('the brake stops the car', atLimit.speed < 1, `${atLimit.speed.toFixed(1)} km/h`);

  const coast = drive({ throttle: 0, brake: 0 }, 1, 200);
  ok('lifting off coasts rather than stopping dead',
    coast.speed < 200 && coast.speed > 180, `${coast.speed.toFixed(0)} km/h`);

  const braking = drive({ throttle: 0, brake: 1 }, 0.5, 250).speed;
  const lifting = drive({ throttle: 0, brake: 0 }, 0.5, 250).speed;
  ok('the brake is far stronger than lifting off', lifting - braking > 40,
    `${(lifting - braking).toFixed(0)} km/h difference in half a second`);

  const held = drive({ throttle: 1, brake: 1 }, 4, 200);
  ok('brake beats throttle when both are down', held.speed < 100, `${held.speed.toFixed(0)} km/h`);

  const corner = drive({ throttle: 1, brake: 0 }, 5, 300, 1);
  ok('cornering still scrubs speed off', corner.speed < 180, `${corner.speed.toFixed(0)} km/h`);

  // With every aid off — how the rig starts — nothing moves the car but a driver.
  const parked = new CarSim();
  for (let i = 0; i < 60 * 20; i++) parked.update(dt, 0);
  ok('every aid starts off', !parked.assists.gears && !parked.assists.throttle && !parked.assists.brake);
  ok('so with no pedals the car does not move by itself', parked.speed === 0, `${parked.speed.toFixed(0)} km/h`);
  ok('and reports that it is not being driven', parked.driven === false);

  // All three on: the car drives itself, as the single-camera rig used to.
  const auto = new CarSim();
  Object.assign(auto.assists, { gears: true, throttle: true, brake: true });
  for (let i = 0; i < 60 * 30; i++) auto.update(dt, 0);
  ok('with every aid on, it drives itself', auto.speed > 250, `${auto.speed.toFixed(0)} km/h`);

  // Auto acceleration alone: it accelerates, through whatever gear it is in.
  const throttleOnly = new CarSim();
  throttleOnly.assists.throttle = true;
  for (let i = 0; i < 60 * 10; i++) throttleOnly.update(dt, 0);
  ok('auto acceleration alone moves the car', throttleOnly.speed > 60, `${throttleOnly.speed.toFixed(0)} km/h`);
  ok('but leaves the gears to the driver', throttleOnly.gear === 1);
  ok('and is held by the gear the driver is in', throttleOnly.speed <= 79, `${throttleOnly.speed.toFixed(0)} km/h`);

  // Auto braking alone: into a corner too fast, it brakes; on a straight it does nothing.
  const into = new CarSim();
  into.assists.brake = true; into.speed = 300; into.gear = 8;
  into.update(dt, 1);
  ok('auto braking brakes for a corner taken too fast', into.brake > 0.5, `brake ${into.brake.toFixed(2)}`);
  const straight = new CarSim();
  straight.assists.brake = true; straight.speed = 200; straight.gear = 5;
  straight.update(dt, 0);
  ok('and not on a straight', straight.brake === 0);
  const noBrake = new CarSim();
  noBrake.speed = 300; noBrake.gear = 8;
  noBrake.update(dt, 1);
  ok('off, it never brakes on its own', noBrake.brake === 0);

  // An aid never fights the driver.
  const fight = new CarSim();
  fight.assists.throttle = true; fight.speed = 100; fight.gear = 3;
  fight.update(dt, 0, { throttle: 0, brake: 0.6 });
  ok('auto acceleration backs off while the driver brakes', fight.throttle === 0 && near(fight.brake, 0.6));

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
  auto.assists.gears = true;
  const gears = new Set();
  for (let i = 0; i < 90 * 60; i++) { auto.update(dt, 0, { throttle: 1, brake: 0 }); gears.add(auto.gear); }
  ok('the box climbs through all eight gears', gears.size === 8, `${gears.size} gears used`);
  ok('and reaches a sensible top speed', auto.speed > 290 && auto.speed <= 330,
    `${auto.speed.toFixed(0)} km/h`);
  ok('in top gear', auto.gear === 8, `gear ${auto.gear}`);

  // Hunting: upshifting at one threshold and downshifting at another that
  // overlaps it makes the box oscillate, which it did — six to seven and back.
  const cruise = new CarSim();
  cruise.assists.gears = true;
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
  slowing.assists.gears = true;
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

  // With the automatic box off, gears change only when the driver changes them.
  const manual = new CarSim();
  for (let i = 0; i < 30 * 60; i++) manual.update(dt, 0, { throttle: 1, brake: 0 });
  ok('with the automatic box off, full throttle stays in first', manual.gear === 1, `gear ${manual.gear}`);
  ok('held at what first will pull', manual.speed <= TOPS[0] + 1, `${manual.speed.toFixed(0)} km/h`);
  ok('a paddle still changes gear', manual.shift(1) === true && manual.gear === 2);

  // And the self-driving car must respect gearing too.
  const legacy = new CarSim();
  legacy.assists.throttle = true;
  legacy.gear = 1; legacy._manualHold = 999;
  for (let i = 0; i < 20 * 60; i++) { legacy._manualHold = 999; legacy.update(dt, 0); }
  ok('the self-driving car is bound by its gear as well', legacy.speed <= TOPS[0] + 1,
    `${legacy.speed.toFixed(0)} km/h in first`);
}

console.log('\nrefused downshifts');
{
  const dt = 1 / 60;
  const TOPS = [78, 118, 158, 196, 232, 267, 298, 330];

  // Refused, as a real gearbox refuses it — and the reason is kept.
  const fast = new CarSim();
  fast.speed = 250; fast.gear = 6;
  ok('a downshift the car is too fast for is refused', fast.shift(-1) === false && fast.gear === 6);
  ok('and says why', fast.refusal?.reason === 'too-fast' && fast.refusal.gear === 5 && fast.refusal.queued === false);
  ok('without the aid, nothing is remembered', fast.queuedDown === 0);
  ok('the drop-in speed is the gear\'s top plus the allowance', fast.gearLimits(5).dropBelow === Math.floor(TOPS[4] * 1.06));
  ok('a shift that works leaves no refusal behind', fast.shift(1) === true && fast.refusal === null);
  const top = new CarSim(); top.gear = 1;
  ok('below first there is only neutral, which is never refused', top.shift(-1) === true && top.gear === 0 && top.refusal === null);

  // With the aid: remembered, and taken the moment the speed allows.
  const braking = () => {
    const c = new CarSim();
    c.assists.queueDown = true;
    c.speed = 295; c.gear = 7;            // too fast for 6th, which takes it below 283
    return c;
  };
  const q = braking();
  ok('with the aid, a refused downshift waits', q.shift(-1) === false && q.refusal.queued === true && q.queuedDown === 1);
  let landedAt = null;
  for (let i = 0; i < 4 * 60 && landedAt === null; i++) {
    q.update(dt, 0, { throttle: 0, brake: 0.6 });
    if (q.queuedShift) landedAt = q.speed;
  }
  ok('it drops in once the speed allows', q.gear === 6 && landedAt !== null);
  ok('and not a moment before', landedAt <= TOPS[5] * 1.06 && landedAt > TOPS[5] * 1.06 - 10, `landed at ${landedAt?.toFixed(0)} km/h`);

  const two = braking();
  two.shift(-1); two.shift(-1);
  ok('two pulls wait for two gears', two.queuedDown === 2);
  for (let i = 0; i < 3 * 60; i++) two.update(dt, 0, { throttle: 0, brake: 1 });
  ok('and both land, one at a time', two.gear === 5 && two.queuedDown === 0, `gear ${two.gear}`);

  const lapse = braking();
  lapse.shift(-1);
  // Held at speed — a driver who lifted the paddle and then carried on flat out.
  for (let i = 0; i < 5 * 60; i++) { lapse.speed = 295; lapse.update(dt, 0, { throttle: 1, brake: 0 }); }
  ok('a remembered downshift lapses if the car never slows', lapse.queuedDown === 0 && lapse.gear === 7);

  const cancel = braking();
  cancel.shift(-1);
  cancel.shift(1);
  ok('shifting up cancels it', cancel.queuedDown === 0);

  const off = braking();
  off.shift(-1);
  off.assists.queueDown = false;
  for (let i = 0; i < 3 * 60; i++) off.update(dt, 0, { throttle: 0, brake: 1 });
  ok('switching the aid off forgets it', off.gear === 7, `gear ${off.gear}`);
}

console.log('\nagainst published F1 figures');
{
  const dt = 1 / 60;
  // Standing start, automatic box, the throttle fed in right at the limit of
  // traction — traction control standing in for a perfect right foot, which
  // is what the published times are: 2.6 s, 4.8 s, 10.5 s.
  const c = new CarSim();
  c.assists.gears = true;
  c.assists.traction = true;
  const at = {};
  for (let t = 0; t < 40; t += dt) {
    c.update(dt, 0, { throttle: 1, brake: 0 });
    for (const mark of [100, 200, 300]) if (at[mark] === undefined && c.speed >= mark) at[mark] = t;
  }
  const within = (x, target, tol) => x !== undefined && Math.abs(x - target) <= tol;
  ok('0–100 km/h in about 2.6 s', within(at[100], 2.6, 0.3), `${at[100]?.toFixed(2)} s`);
  ok('0–200 km/h in about 4.8 s', within(at[200], 4.8, 0.4), `${at[200]?.toFixed(2)} s`);
  ok('0–300 km/h in about 10.5 s', within(at[300], 10.5, 1), `${at[300]?.toFixed(2)} s`);
  ok('and on to over 315 km/h', c.speed > 315, `${c.speed.toFixed(0)} km/h`);

  /** Deceleration with the foot off and no brake, in g, at a speed in a given gear. */
  const liftOff = (speed, gear) => {
    const car = new CarSim();
    car.speed = speed; car.gear = gear;
    const before = car.speed;
    car.update(dt, 0, { throttle: 0, brake: 0 });
    return { g: ((before - car.speed) / dt) / 3.6 / 9.81, parts: car.resistance };
  };
  const top = liftOff(325, 8);
  ok('lifting off at top speed slows it at about 1 g, with no brake', top.g > 0.85 && top.g < 1.15, `${top.g.toFixed(2)} g`);
  ok('almost all of that is drag', top.parts.aero > 0.7 && top.parts.aero > 4 * top.parts.engine,
    `aero ${top.parts.aero.toFixed(2)} g, engine ${top.parts.engine.toFixed(2)} g`);
  const mid = liftOff(200, 5);
  ok('at 200 km/h it is about half that', mid.g > 0.35 && mid.g < 0.6, `${mid.g.toFixed(2)} g`);
  const slow = liftOff(100, 2);
  ok('at 100 km/h the air hardly matters and engine braking leads', slow.parts.engine > 2 * slow.parts.aero,
    `aero ${slow.parts.aero.toFixed(2)} g, engine ${slow.parts.engine.toFixed(2)} g`);
  ok('lifting off is still far gentler than the brakes', top.g < 5.4 / 4);
  const tall = liftOff(100, 8);
  ok('engine braking is weaker in a tall gear', tall.parts.engine < slow.parts.engine / 2,
    `8th ${tall.parts.engine.toFixed(2)} g vs 2nd ${slow.parts.engine.toFixed(2)} g`);
  const crawl = liftOff(20, 1);
  ok('and fades as revs fall toward idle', crawl.parts.engine < slow.parts.engine / 2);

  // Coasting from top speed: drag falls away with speed, so it slows hard
  // at first and then ever more gently.
  const coast = new CarSim();
  coast.assists.gears = true; coast.speed = 320; coast.gear = 8;
  const trace = [];
  for (let i = 0; i <= 10 * 60; i++) { if (i % 60 === 0) trace.push(coast.speed); coast.update(dt, 0, { throttle: 0, brake: 0 }); }
  const firstSecond = trace[0] - trace[1], tenthSecond = trace[9] - trace[10];
  ok('a coast sheds speed fastest at the start', firstSecond > 2 * tenthSecond,
    `${firstSecond.toFixed(0)} km/h in the first second, ${tenthSecond.toFixed(0)} in the tenth`);
  ok('and never stops dead on its own in that time', trace[10] > 60, `${trace[10].toFixed(0)} km/h after 10 s`);
}

console.log('\nthe throttle pedal');
{
  const dt = 1 / 120;
  // Pedal map: the first half of the travel is fine control.
  const half = new CarSim(); half.speed = 150; half.gear = 4;
  for (let i = 0; i < 60; i++) half.update(dt, 0, { throttle: 0.5, brake: 0 });
  ok('half the pedal asks for less than half the torque', half.torque < 0.45 && half.torque > 0.3, `${half.torque.toFixed(2)}`);
  const full = new CarSim(); full.speed = 150; full.gear = 4;
  for (let i = 0; i < 60; i++) full.update(dt, 0, { throttle: 1, brake: 0 });
  ok('and the car pulls harder the further it goes down', full.accelG > half.accelG * 1.5,
    `${half.accelG.toFixed(2)} g vs ${full.accelG.toFixed(2)} g`);

  // Response: quick, not instant.
  const step = new CarSim(); step.speed = 150; step.gear = 4;
  step.update(dt, 0, { throttle: 1, brake: 0 });
  const first = step.torque;
  for (let i = 0; i < 0.15 / dt; i++) step.update(dt, 0, { throttle: 1, brake: 0 });
  ok('the engine answers a stab of throttle within a tenth or two', first < 0.3 && step.torque > 0.9,
    `${first.toFixed(2)} after one frame, ${step.torque.toFixed(2)} after 150 ms`);

  // Traction: too much throttle in a low gear spins the rears.
  const stamp = new CarSim(); stamp.speed = 40; stamp.gear = 1;
  for (let i = 0; i < 30; i++) stamp.update(dt, 0, { throttle: 1, brake: 0 });
  ok('full throttle in first spins the rear tyres', stamp.wheelspin === true);
  // First gear can push at four times what the rear tyres hold, so gently
  // means gently — about a third of the pedal.
  const feed = new CarSim(); feed.speed = 40; feed.gear = 1;
  for (let i = 0; i < 30; i++) feed.update(dt, 0, { throttle: 0.3, brake: 0 });
  ok('fed in gently, they grip', feed.wheelspin === false);
  ok('and the car goes faster for it', feed.accelG > stamp.accelG, `${feed.accelG.toFixed(2)} g vs ${stamp.accelG.toFixed(2)} g spinning`);
  const tall = new CarSim(); tall.speed = 220; tall.gear = 6;
  for (let i = 0; i < 30; i++) tall.update(dt, 0, { throttle: 1, brake: 0 });
  ok('at speed, with downforce, full throttle grips', tall.wheelspin === false);
  const spinUp = new CarSim(); spinUp.speed = 40; spinUp.gear = 1;
  for (let i = 0; i < 30; i++) spinUp.update(dt, 0, { throttle: 1, brake: 0 });
  for (let i = 0; i < 30; i++) spinUp.update(dt, 0, { throttle: 0.85, brake: 0 });
  ok('a spin does not stop by easing off a little', spinUp.wheelspin === true);
  for (let i = 0; i < 30; i++) spinUp.update(dt, 0, { throttle: 0.2, brake: 0 });
  ok('it stops when the throttle comes well back', spinUp.wheelspin === false);
  const tc = new CarSim(); tc.assists.traction = true; tc.speed = 40; tc.gear = 1;
  for (let i = 0; i < 30; i++) tc.update(dt, 0, { throttle: 1, brake: 0 });
  ok('traction control, when switched on, never lets them spin', tc.wheelspin === false);

  const launch = (traction) => {
    const car = new CarSim(); car.assists.gears = true; car.assists.traction = traction;
    let t = 0;
    while (car.speed < 100 && t < 10) { car.update(dt, 0, { throttle: 1, brake: 0 }); t += dt; }
    return t;
  };
  ok('stamping it off the line is slower than feeding it in', launch(false) > launch(true) + 0.3,
    `${launch(false).toFixed(2)} s vs ${launch(true).toFixed(2)} s to 100`);
}

console.log('\nthe brake pedal');
{
  const dt = 1 / 120;
  /** Deceleration at a speed with the brakes at the limit, in g. */
  const limit = (speed) => {
    const c = new CarSim(); c.speed = speed; c.gear = 8; c.assists.abs = true; c.pressure = 1;
    c.update(dt, 0, { throttle: 0, brake: 1 });
    return -c.accelG;
  };
  ok('5 g and more from 300 km/h', limit(300) > 4.8 && limit(300) < 6, `${limit(300).toFixed(2)} g`);
  ok('falling with speed as the downforce goes: about 2.5 g at 100', limit(100) > 2.1 && limit(100) < 2.9, `${limit(100).toFixed(2)} g`);
  ok('and about 2 g at a crawl', limit(40) > 1.7 && limit(40) < 2.3, `${limit(40).toFixed(2)} g`);

  // Pressure is proportional to the pedal.
  const part = new CarSim(); part.speed = 250; part.gear = 7;
  for (let i = 0; i < 24; i++) part.update(dt, 0, { throttle: 0, brake: 0.4 });
  ok('40% pedal is 40% line pressure', Math.abs(part.telemetry.brakeBar - 40) < 1, `${part.telemetry.brakeBar.toFixed(0)} bar`);
  const more = new CarSim(); more.speed = 250; more.gear = 7;
  for (let i = 0; i < 24; i++) more.update(dt, 0, { throttle: 0, brake: 0.8 });
  ok('and twice the pedal slows it nearly twice as hard', -more.accelG > -part.accelG * 1.6,
    `${(-part.accelG).toFixed(2)} g vs ${(-more.accelG).toFixed(2)} g`);

  // No ABS: full pressure is right at 300 and far too much at 150.
  const stopFrom300 = (pedal) => {
    const c = new CarSim(); c.speed = 300; c.gear = 8; c.assists.gears = true;
    let t = 0, d = 0, locked = 0;
    while (c.speed > 80 && t < 6) {
      c.update(dt, 0, { throttle: 0, brake: pedal(c) });
      t += dt; d += c.speed / 3.6 * dt; if (c.lockup) locked += dt;
    }
    return { t, d, locked };
  };
  const stamped = stopFrom300(() => 1);
  // A driver who comes off the pedal as the grip falls away, as F1 drivers do,
  // leaving room for the engine braking that goes through the same tyres.
  const eased = stopFrom300((c) => Math.min(1,
    (c.grip.brake * 0.9 - c.resistance.engine) / (4.4 * brakeTempFactor(c.brakeTemp))));
  ok('full pressure held all the way down locks the tyres', stamped.locked > 0.5, `locked ${stamped.locked.toFixed(2)} s`);
  ok('easing off as the car slows does not', eased.locked === 0);
  ok('and stops shorter', eased.d < stamped.d - 10, `${eased.d.toFixed(0)} m vs ${stamped.d.toFixed(0)} m locked`);
  ok('300→80 in about 2 s, as published', eased.t > 1.6 && eased.t < 2.4, `${eased.t.toFixed(2)} s`);

  const lock = new CarSim(); lock.speed = 120; lock.gear = 3;
  for (let i = 0; i < 12; i++) lock.update(dt, 0, { throttle: 0, brake: 1 });
  ok('stamped at 120 km/h, the tyres lock', lock.lockup === true);
  for (let i = 0; i < 12; i++) lock.update(dt, 0, { throttle: 0, brake: 0.3 });
  ok('and come back once the pedal does', lock.lockup === false);
  const abs = new CarSim(); abs.assists.abs = true; abs.speed = 120; abs.gear = 3;
  for (let i = 0; i < 12; i++) abs.update(dt, 0, { throttle: 0, brake: 1 });
  ok('ABS, when switched on, never lets them lock', abs.lockup === false);

  // Carbon brakes only work hot.
  ok('cold carbon has a fraction of its bite', brakeTempFactor(30) < 0.25);
  ok('full bite through the working window', brakeTempFactor(400) === 1 && brakeTempFactor(900) === 1);
  ok('fading when they overheat', brakeTempFactor(1200) < 1);
  const cold = new CarSim(); cold.brakeTemp = 30; cold.speed = 200; cold.gear = 5;
  const warm = new CarSim(); warm.speed = 200; warm.gear = 5;
  for (let i = 0; i < 24; i++) { cold.update(dt, 0, { throttle: 0, brake: 0.6 }); warm.update(dt, 0, { throttle: 0, brake: 0.6 }); }
  ok('cold brakes barely slow the car', -cold.accelG < -warm.accelG * 0.6, `${(-cold.accelG).toFixed(2)} g vs ${(-warm.accelG).toFixed(2)} g hot`);
  ok('the car starts with them warm', new CarSim().brakeTemp >= 400);
  const heat = new CarSim(); heat.assists.abs = true; heat.speed = 300; heat.gear = 8; heat.assists.gears = true;
  while (heat.speed > 80) heat.update(dt, 0, { throttle: 0, brake: 1 });
  const peak = heat.brakeTemp;
  ok('a big stop heats them', peak > 650, `${peak.toFixed(0)} °C`);
  for (let i = 0; i < 10 / dt; i++) { heat.speed = 250; heat.update(dt, 0, { throttle: 1, brake: 0 }); }
  ok('and a straight cools them back into the window', heat.brakeTemp < peak - 100 && heat.brakeTemp > 400, `${heat.brakeTemp.toFixed(0)} °C`);
}

console.log('\nneutral and reverse');
{
  const dt = 1 / 120;
  const parked = new CarSim({ gear: NEUTRAL });
  for (let i = 0; i < 120; i++) parked.update(dt, 0, { throttle: 1, brake: 0 });
  ok('in neutral, the throttle does not move the car', parked.speed === 0);
  ok('it just revs the engine', parked.rpm > 10000, `${parked.rpm.toFixed(0)} rpm`);
  ok('and the display says N', parked.telemetry.gearLabel === 'N');

  ok('the paddle takes it from neutral into first', parked.shift(1) === true && parked.gear === 1);
  // The box runs R – N – 1: down from neutral is reverse, but only stopped.
  const n2 = new CarSim({ gear: NEUTRAL });
  ok('stopped, shifting down from neutral selects reverse', n2.shift(-1) === true && n2.gear === REVERSE);
  ok('and down again does nothing more', n2.shift(-1) === false && n2.gear === REVERSE);
  const rolling = new CarSim({ gear: NEUTRAL }); rolling.speed = 40;
  ok('moving, it is refused, so a stray pull cannot select it', rolling.shift(-1) === false
    && rolling.gear === NEUTRAL && rolling.refusal.reason === 'moving');
  const twice = new CarSim(); twice.gear = 1;
  twice.shift(-1); twice.shift(-1);
  ok('from first, stopped, two pulls down is reverse', twice.gear === REVERSE);

  // Down from first is neutral, as on a sequential box.
  const first = new CarSim(); first.speed = 30; first.gear = 1;
  ok('shifting down from first selects neutral', first.shift(-1) === true && first.gear === NEUTRAL);
  ok('and the display says N', first.telemetry.gearLabel === 'N');
  for (let i = 0; i < 60; i++) first.update(1 / 60, 0, { throttle: 1, brake: 0 });
  ok('where the throttle no longer drives it', first.speed < 30 && first.resistance.engine === 0);
  ok('and shifting up puts it back in gear', first.shift(1) === true && first.gear === 1);
  const stopped = new CarSim(); stopped.gear = 1;
  ok('stopped, too', stopped.shift(-1) === true && stopped.gear === NEUTRAL);
  const queued = new CarSim(); queued.assists.queueDown = true; queued.speed = 20; queued.gear = 1;
  queued.shift(-1);
  ok('and nothing is left queued behind it', queued.queuedDown === 0);
  const coastN = new CarSim({ gear: NEUTRAL }); coastN.speed = 200;
  // 4th tops out at 196 km/h and takes up to 6% over it, so it is the lowest that will.
  ok('out of neutral at speed, the paddle picks the lowest gear that will take it', coastN.shift(1) === true && coastN.gear === 4,
    `gear ${coastN.gear}`);

  // Coasting in neutral: no engine braking.
  const geared = new CarSim(); geared.speed = 100; geared.gear = 2;
  const free = new CarSim({ gear: NEUTRAL }); free.speed = 100;
  for (let i = 0; i < 60; i++) { geared.update(dt, 0, { throttle: 0, brake: 0 }); free.update(dt, 0, { throttle: 0, brake: 0 }); }
  ok('coasting in neutral loses only drag, no engine braking', free.speed > geared.speed + 1 && free.resistance.engine === 0,
    `${free.speed.toFixed(1)} vs ${geared.speed.toFixed(1)} km/h in second`);

  const fast = new CarSim(); fast.speed = 120; fast.gear = 3;
  ok('reverse is refused while moving', fast.selectReverse() === false && fast.refusal.reason === 'moving' && fast.gear === 3);
  ok('neutral is not — the button always works', fast.selectNeutral() === true && fast.gear === NEUTRAL);

  const back = new CarSim({ gear: NEUTRAL });
  ok('stopped, reverse engages', back.selectReverse() === true && back.gear === REVERSE && back.telemetry.gearLabel === 'R');
  for (let i = 0; i < 4 / dt; i++) back.update(dt, 0, { throttle: 0.5, brake: 0 });
  ok('and the throttle drives it backwards', back.direction === -1 && back.speed > 10, `${back.speed.toFixed(0)} km/h backwards`);
  ok('telemetry says so', back.telemetry.reversing === true);
  for (let i = 0; i < 10 / dt; i++) back.update(dt, 0, { throttle: 1, brake: 0 });
  ok('reverse is a slow gear', back.speed <= 62, `${back.speed.toFixed(0)} km/h`);
  ok('shifting up from reverse goes to neutral, not straight to first', back.shift(1) === true && back.gear === NEUTRAL);
  ok('even while still rolling back', back.direction === -1 && back.speed > 10);
  ok('but first is refused until it stops rolling back', back.shift(1) === false && back.refusal.reason === 'rolling-back');
  for (let i = 0; i < 3 / dt; i++) back.update(dt, 0, { throttle: 0, brake: 0.5 });
  ok('the brakes stop it rolling back', back.speed === 0);
  ok('and do not push it forwards', back.speed === 0 && back.direction === -1);
  ok('stopped, first engages again', back.shift(1) === true && back.gear === 1);
  const steps = new CarSim({ gear: REVERSE });
  const seen = [steps.telemetry.gearLabel];
  for (let i = 0; i < 3; i++) { steps.shift(1); seen.push(steps.telemetry.gearLabel); }
  ok('up from reverse goes one step at a time: R, N, 1, 2', seen.join() === 'R,N,1,2', seen.join());
  for (let i = 0; i < 2 / dt; i++) back.update(dt, 0, { throttle: 0.3, brake: 0 });
  ok('and it drives off forwards', back.direction === 1 && back.speed > 10);

  // Rolling backwards in first: the engine drives against the roll and wins.
  const roll = new CarSim(); roll.speed = 8; roll.direction = -1; roll.gear = 1;
  for (let i = 0; i < 2 / dt; i++) roll.update(dt, 0, { throttle: 0.3, brake: 0 });
  ok('first gear pulls a car rolling backwards to a stop and then forwards', roll.direction === 1 && roll.speed > 5);

  // The automatic box takes it out of neutral when asked to go, never into reverse.
  const auto = new CarSim({ gear: NEUTRAL }); auto.assists.gears = true;
  for (let i = 0; i < 60; i++) auto.update(dt, 0, { throttle: 0.4, brake: 0 });
  ok('the automatic box selects first when you press the throttle in neutral', auto.gear === 1 && auto.speed > 0);
  const autoR = new CarSim({ gear: REVERSE }); autoR.assists.gears = true;
  for (let i = 0; i < 60; i++) autoR.update(dt, 0, { throttle: 0.4, brake: 0 });
  ok('but leaves reverse alone', autoR.gear === REVERSE);
}

console.log(failures === 0 ? '\nall pedal checks passed\n' : `\n${failures} pedal check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
