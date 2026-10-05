/**
 * Tests for physical-wheel support.
 *
 *   node tools/check-wheel.mjs
 *
 * No wheel needed. The Gamepad API is reduced to what it hands over — an id,
 * a mapping and two arrays — so a stub pad stands in for the hardware, and
 * the wizard can be walked through every step by changing numbers in it.
 */
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const {
  parseIds, displayName, isLikelyWheel, chooseDevice, defaultMapping,
  steerDegrees, pedalValue, MappingWizard, WIZARD_STEPS, PEDAL_STEPS, steerToAxis, LeadTracker,
  defaultPedals, choosePedalDevice, PADDLE_STEPS, uniquePedals, samePedal, inputLabel, lockFor,
  RotationMeasurement, SweepCalibration, lockRange,
} = await import('../src/input/wheels.js');
const { KeyboardSource } = await import('../src/input/keyboard.js');
const { ShiftGate, Shifter } = await import('../src/input/shifter.js');
const { SteeringController } = await import('../src/input/controller.js');
const { WheelSource } = await import('../src/input/wheelsource.js');
const { PedalSet } = await import('../src/input/pedalset.js');

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const G29 = 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)';
const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const PEDALS = 'Fanatec ClubSport Pedals V3 (Vendor: 0eb7 Product: 183b)';

/** A G29-ish pad: steering on 0, pedals on 1 and 2 resting at +1, paddles on 4 and 5. */
function wheelPad(id = G29) {
  return {
    id, mapping: '', connected: true,
    axes: [0, 1, 1, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  };
}
const press = (pad, i, on = true) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };

console.log('\nrecognising a wheel');
{
  ok('reads Chromium ids', JSON.stringify(parseIds(G29)) === '{"vendor":"046d","product":"c24f"}');
  ok('reads Firefox ids', parseIds('46d-c24f-Logitech G29').product === 'c24f');
  ok('names it without the bracketed ids', displayName(G29) === 'Logitech G29 Driving Force Racing Wheel');
  ok('a Moza wheel goes by Moza, not its maker\'s company name',
    displayName('Gudsen R3 Racing Wheel and Pedals (Vendor: 346e Product: 0005)') === 'Moza R3 Racing Wheel and Pedals');
  ok('and is a wheel by its vendor id', isLikelyWheel('Gudsen R3 Racing Wheel and Pedals (Vendor: 346e Product: 0005)'));
  ok('a G29 is a wheel', isLikelyWheel(G29));
  ok('a Logitech wheel is known by its product id alone', isLikelyWheel('Unknown (Vendor: 046d Product: c262)'));
  ok('a Fanatec device is known by its vendor alone', isLikelyWheel('Unknown (Vendor: 0eb7 Product: 0001)'));
  ok('an Xbox pad is not a wheel', !isLikelyWheel(XBOX));
  ok('nor is a Logitech pad', !isLikelyWheel('Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c216)'));
}

console.log('\nchoosing a device');
{
  const pad = { id: XBOX }, wheel = { id: G29 };
  ok('a wheel is picked over a pad', chooseDevice([pad, wheel], null) === G29);
  ok('a pad on its own is not picked', chooseDevice([pad], null) === null);
  ok('a pad the driver chose is', chooseDevice([pad, wheel], XBOX) === XBOX);
  ok('a remembered device that has gone falls back to the wheel', chooseDevice([wheel], 'gone') === G29);
}

console.log('\nreading a wheel');
{
  const pad = wheelPad();
  const m = defaultMapping(pad);
  ok('a wheel steers on axis 0 by default', m.steer.index === 0);
  ok('until calibrated, any wheel is assumed to turn ±360°', m.rotation === 720 && m.rotationFrom === 'default'
    && defaultMapping({ id: 'T300RS (Vendor: 044f Product: b66e)' }).rotation === 720);

  pad.axes[0] = 0.1;
  ok('so 0.1 of the axis reads 36°, and full lock 360°', near(steerDegrees(m, [pad]), 36)
    && near(steerDegrees(m, [{ id: G29, axes: [1] }]), 360));
  ok('a missing device reads null rather than straight', steerDegrees(m, []) === null);
}

console.log('\nreading a pedal');
{
  const pad = wheelPad();
  const thr = { pad: G29, kind: 'axis', index: 1, rest: 1, full: -1 };
  ok('a pedal resting at +1 reads 0', pedalValue(thr, [pad]) === 0);
  pad.axes[1] = -1;
  ok('and fully pressed at −1 reads 1', near(pedalValue(thr, [pad]), 1));
  pad.axes[1] = 0.95;
  ok('a foot resting on it is inside the deadzone', pedalValue(thr, [pad]) === 0);
  ok('an unbound pedal reads null', pedalValue(null, [pad]) === null);
}

/** What the desktop helper reports for the R3: ABS 0–7, then the hat. */
const R3 = 'Gudsen R3 Racing Wheel and Pedals (Vendor: 346e Product: 0005)';
const R3_CODES = [0, 1, 2, 3, 4, 5, 6, 7, 16, 17];
const r3Pad = () => ({ id: R3, mapping: '', codes: R3_CODES, axes: [0, -1, -1, -1, -1, -1, -1, -1, 0, 0], buttons: Array(128).fill(0) });

console.log('\npedals with no setup');
{
  const r3 = defaultPedals(r3Pad());
  ok('a Moza R3\'s throttle is ABS_Z, as Boxflat records it', r3.throttle?.index === R3_CODES.indexOf(2));
  ok('its brake ABS_RZ', r3.brake?.index === R3_CODES.indexOf(5));
  ok('and its clutch ABS_THROTTLE', r3.clutch?.index === R3_CODES.indexOf(6));
  const pad = r3Pad();
  ok('at rest they read 0', pedalValue(r3.throttle, [pad]) === 0 && pedalValue(r3.brake, [pad]) === 0);
  pad.axes[2] = 1;
  ok('floored, the throttle reads 1', near(pedalValue(r3.throttle, [pad]), 1));

  const srp = defaultPedals({ id: 'Gudsen MOZA SR-P Pedals (Vendor: 346e Product: 0003)', codes: [3, 4, 5] });
  ok('Moza pedals on their own cable are RX, RY, RZ', srp.throttle?.index === 0 && srp.brake?.index === 1 && srp.clutch?.index === 2);
  ok('without axis codes a layout is not guessed', defaultPedals({ id: R3, axes: [] }).throttle === null);
  ok('nor for a wheel whose layout is unknown', defaultPedals(wheelPad()).throttle === null);

  const xbox = { id: XBOX, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array(17).fill(0) };
  const xp = defaultPedals(xbox);
  xbox.buttons[7] = { pressed: true, value: 0.5 };
  ok('a standard pad has its triggers as pedals', xp.throttle?.index === 7 && pedalValue(xp.throttle, [xbox]) > 0.4);
}

console.log('\nchoosing the pedals');
{
  const wheel = { id: G29 }, pedals = { id: PEDALS }, pad = { id: XBOX };
  ok('a pedal set is picked over the wheel it sits beside', choosePedalDevice([wheel, pedals], null) === PEDALS);
  ok('with no pedal set, the wheel (pedals through the base)', choosePedalDevice([pad, wheel], null) === G29);
  ok('a pad is never picked on its own', choosePedalDevice([pad], null) === null);
  ok('a choice that is plugged in wins', choosePedalDevice([wheel, pedals], G29) === G29);
}

console.log('\nthe wheel wizard');
{
  const pad = wheelPad();
  const wiz = new MappingWizard([pad], defaultMapping(pad));
  ok('starts with the steering', wiz.current.key === 'steer');

  pad.axes[0] = -0.05;
  wiz.feed([pad]);
  ok('a small wobble is not a quarter turn', wiz.current.key === 'steer');
  pad.axes[0] = -0.2;
  ok('a turn to the right is learned', wiz.feed([pad]) === 'steer');
  ok('including that this wheel reads negative to the right', wiz.result.steer.sign === -1);

  press(pad, 5);
  wiz.feed([pad]);
  ok('a held button keeps the next step waiting', wiz.current.key === 'up' && !wiz.listening);
  press(pad, 5, false);
  wiz.feed([pad]);
  ok('a turned wheel does not hold it up once everything else is back', wiz.listening);

  press(pad, 5);
  ok('the upshift paddle is learned', wiz.feed([pad]) === 'up' && wiz.result.up.index === 5);
  press(pad, 5, false); wiz.feed([pad]);
  press(pad, 5);
  wiz.feed([pad]);
  ok('pulling the same paddle again does not bind it as downshift too', wiz.current?.key === 'down');
  press(pad, 5, false); wiz.feed([pad]);
  press(pad, 4);
  ok('the downshift paddle is learned', wiz.feed([pad]) === 'down' && wiz.result.down.index === 4);
  press(pad, 4, false); wiz.feed([pad]);
  ok('then the neutral button', wiz.current?.key === 'neutral');
  press(pad, 9); ok('which is learned', wiz.feed([pad]) === 'neutral' && wiz.result.neutral.index === 9);
  press(pad, 9, false); wiz.feed([pad]);
  wiz.skip();
  ok('reverse can be skipped — holding neutral selects it', wiz.finished && !wiz.result.reverse);
  ok('and that is everything', WIZARD_STEPS.length === 5);
}

console.log('\nthe pedal wizard');
{
  const pad = wheelPad();                      // pedals on axes 1 and 2, resting at +1
  const steer = { pad: G29, kind: 'axis', index: 0, centre: 0, sign: 1 };
  const wiz = new MappingWizard([pad], { steer }, PEDAL_STEPS);
  ok('starts with the throttle', wiz.current.key === 'throttle');

  pad.axes[0] = 0.8;
  wiz.feed([pad]);
  ok('turning the wheel is not taken for a pedal', wiz.current.key === 'throttle' && wiz.listening);
  pad.axes[0] = 0;

  pad.axes[2] = -0.6;
  wiz.feed([pad]);
  ok('a pressed pedal is found', wiz.pressing && wiz.notice?.tone === 'ok');
  ok('but does not count until it is let go', wiz.current.key === 'throttle');
  pad.axes[2] = -0.86;                         // …pressed further, to the floor
  wiz.feed([pad]);
  pad.axes[2] = 1;                             // then let go
  ok('let go, the throttle counts', wiz.feed([pad]) === 'throttle' && wiz.current.key === 'brake');
  ok('and says which input it is', /set on axis 2/.test(wiz.notice?.text ?? ''), wiz.notice?.text);
  const thr = wiz.mapping.throttle;
  ok('its real travel is measured: floored reads 100%', near(pedalValue(thr, [{ id: G29, axes: [0, 0, -0.86] }]), 1));
  ok('and half of it reads about half', Math.abs(pedalValue(thr, [{ id: G29, axes: [0, 0, 1 - 0.93] }]) - 0.5) < 0.05);

  pad.axes[1] = -1;
  wiz.feed([pad]);
  pad.axes[1] = 1;
  ok('the brake counts on release too', wiz.feed([pad]) === 'brake' && wiz.result.brake.index === 1);
  wiz.skip();
  ok('no clutch is fine', wiz.finished && !wiz.mapping.clutch);
}

console.log('\ntwo pedals at once');
{
  const pad = wheelPad();
  const wiz = new MappingWizard([pad], {}, PEDAL_STEPS);
  pad.axes[1] = -1; pad.axes[2] = -1;          // both floored in the same instant
  wiz.feed([pad]);
  ok('pressed together, the round is refused', !wiz.pressing && wiz.notice?.tone === 'warn');
  ok('and the driver is told to redo it', /Two pedals/.test(wiz.notice.text) && /only the throttle/.test(wiz.notice.text), wiz.notice?.text);
  ok('nothing was bound', !wiz.result.throttle);
  pad.axes[1] = 1; pad.axes[2] = 1;
  wiz.feed([pad]);
  ok('let go, it asks for the same pedal again', wiz.listening && wiz.current.key === 'throttle');

  // Now one at first, and the other joining part way down.
  pad.axes[2] = -0.5;
  wiz.feed([pad]);
  ok('one pedal is found', wiz.pressing);
  pad.axes[2] = -1; pad.axes[1] = 0.2;          // the other foot leans on the brake
  wiz.feed([pad]);
  pad.axes[2] = 1; pad.axes[1] = 1;
  const r = wiz.feed([pad]);
  ok('a second pedal joining mid-press throws the round out', r === null && wiz.current.key === 'throttle');
  ok('says why', wiz.notice?.tone === 'warn' && /Another pedal moved/.test(wiz.notice.text), wiz.notice?.text);
  ok('and the throttle is left as it was', !wiz.result.throttle);

  pad.axes[2] = -1; wiz.feed([pad]);
  pad.axes[1] = 0.9; wiz.feed([pad]);           // a foot resting lightly is not a press
  pad.axes[2] = 1; pad.axes[1] = 1;
  ok('a foot merely resting on another pedal is allowed', wiz.feed([pad]) === 'throttle');
}

console.log('\none pedal, one job');
{
  const pad = wheelPad();
  const wiz = new MappingWizard([pad], {}, PEDAL_STEPS);
  pad.axes[2] = -1; wiz.feed([pad]); pad.axes[2] = 1; wiz.feed([pad]);
  ok('throttle set', wiz.result.throttle?.index === 2);
  pad.axes[2] = -1;                            // the throttle again, when asked for the brake
  wiz.feed([pad]);
  ok('the throttle is refused as the brake', !wiz.pressing && wiz.current.key === 'brake');
  ok('with a reason', /already your throttle/.test(wiz.notice?.text ?? ''), wiz.notice?.text);
  pad.axes[2] = 1; wiz.feed([pad]);
  pad.axes[1] = -1; wiz.feed([pad]); pad.axes[1] = 1;
  ok('the real brake is accepted', wiz.feed([pad]) === 'brake');
  pad.axes[1] = -1; wiz.feed([pad]);
  ok('and refused again as the clutch', /already your brake/.test(wiz.notice?.text ?? ''));
  pad.axes[1] = 1; wiz.feed([pad]);

  press(pad, 3);
  wiz.feed([pad]);
  ok('a wheel button is not a pedal', !wiz.pressing && wiz.current.key === 'clutch');
  press(pad, 3, false); wiz.feed([pad]);
  wiz.skip();

  // A skipped step keeps its old binding — unless that is now another pedal's.
  const stale = { pad: G29, kind: 'axis', index: 2, rest: 1, full: -1 };
  const again = new MappingWizard([pad], { clutch: stale }, PEDAL_STEPS);
  pad.axes[2] = -1; again.feed([pad]); pad.axes[2] = 1; again.feed([pad]);
  again.skip(); again.skip();
  ok('a kept binding that collides with a new one is dropped', again.mapping.throttle?.index === 2 && again.mapping.clutch === null);

  const both = { throttle: stale, brake: { ...stale }, clutch: null };
  ok('a stored mapping with one pedal as two jobs keeps only the first', uniquePedals(both).throttle && uniquePedals(both).brake === null);
  const combined = { throttle: { ...stale, rest: 0, full: 1 }, brake: { ...stale, rest: 0, full: -1 } };
  ok('two pedals on one combined axis are not the same pedal', !samePedal(combined.throttle, combined.brake)
    && uniquePedals(combined).brake !== null);
  ok('inputs are named by evdev code when known', inputLabel({ pad: R3, kind: 'axis', index: 2 }, [r3Pad()]) === 'ABS_Z');
}

console.log('\npedals already stored twice');
{
  store = { 'wheelhouse.pedals': JSON.stringify({ last: null, maps: { [G29]: {
    throttle: { pad: G29, kind: 'axis', index: 2, rest: 1, full: -1 },
    brake: { pad: G29, kind: 'axis', index: 2, rest: 1, full: -1 }, clutch: null } } }) };
  const set = new PedalSet({ getPads: () => [wheelPad()] });
  set.poll();
  ok('are cleaned up when loaded: one pedal, one job', set.mapping.throttle && set.mapping.brake === null);
}

console.log('\npedals on a different device from the wheel');
{
  const wheel = wheelPad();
  const pedals = { id: PEDALS, mapping: '', axes: [-1, -1, -1], buttons: [] };
  const wiz = new MappingWizard([wheel, pedals], {}, PEDAL_STEPS);
  pedals.axes[0] = 1;
  wiz.feed([wheel, pedals]);
  pedals.axes[0] = -1;
  wiz.feed([wheel, pedals]);
  ok('a throttle on its own USB device is learned', wiz.result.throttle?.pad === PEDALS);
  pedals.axes[0] = 1;
  ok('and reads through', near(pedalValue(wiz.result.throttle, [wheel, pedals]), 1));
}

console.log('\na combined-axis pedal set');
{
  // Some wheels report throttle and brake as one axis: one way for each.
  const pad = wheelPad();
  pad.axes[1] = 0;
  const wiz = new MappingWizard([pad], {}, PEDAL_STEPS);
  pad.axes[1] = 1; wiz.feed([pad]);
  pad.axes[1] = 0; wiz.feed([pad]); wiz.feed([pad]);
  pad.axes[1] = -1; wiz.feed([pad]);
  const m = wiz.mapping;
  ok('both pedals land on the same axis, facing opposite ways',
    m.throttle?.index === 1 && m.brake?.index === 1 && m.throttle.full > 0.9 && m.brake.full < -0.9);
}

console.log('\nthe wheel source, live');
{
  store = {};
  let pads = [];
  const events = [], shifts = [];
  const src = new WheelSource({
    getPads: () => pads,
    onDevice: (e) => events.push(e),
    onShift: (d) => shifts.push(d),
  });
  await src.connect();

  src.poll();
  ok('nothing plugged in steers nothing', src.read() === null && !src.connected);

  pads = [{ id: XBOX, mapping: 'standard', axes: [0.5, 0, 0, 0], buttons: Array(17).fill(0) }];
  src.poll();
  ok('a pad left on the desk does not take the steering', src.read() === null);

  const pad = wheelPad();
  pads = [pads[0], pad];
  pad.axes[0] = 0.1;
  src.poll();
  ok('a wheel connects by itself', src.connected && events.at(-1)?.type === 'connected');
  const r = src.read();
  ok('and steers, placed rather than sprung to', r && near(r.angle, 36 * Math.PI / 180) && r.snap === true);

  src.mapping = { ...src.mapping, up: { pad: G29, kind: 'button', index: 5 }, down: { pad: G29, kind: 'button', index: 4 } };
  press(pad, 5); src.poll(); src.poll();
  press(pad, 5, false); src.poll();
  press(pad, 4); src.poll();
  ok('a paddle shifts once per pull', JSON.stringify(shifts) === '[1,-1]', JSON.stringify(shifts));

  src.enabled = false;
  ok('switched off, it does not steer', src.read() === null);
  src.enabled = true;

  src.startWizard();
  ok('while mapping, it does not steer', src.read() === null);
  src.cancelWizard();

  pads = [pads[0]];
  src.poll();
  ok('unplugged, it lets go', src.read() === null);
  ok('and says so', events.at(-1)?.type === 'disconnected');

  src.select(XBOX);
  ok('a pad the driver picks does steer', src.connected && src.read() !== null);
  ok('and the choice is remembered', JSON.parse(store['wheelhouse.wheels']).last === XBOX);
}

console.log('\nthe pedal set, live');
{
  store = {};
  let pads = [];
  const events = [];
  const set = new PedalSet({ getPads: () => pads, onDevice: (e) => events.push(e) });
  set.poll();
  ok('nothing plugged in drives nothing', set.state === 'none' && set.pedals() === null);

  const pad = r3Pad();
  pads = [pad];
  set.poll();
  ok('a Moza R3\'s pedals connect by themselves', set.connected && events.at(-1)?.type === 'connected');
  ok('already mapped, so ready to drive', events.at(-1)?.ready === true && set.mapped);
  ok('untouched, they leave the car driving itself', set.state === 'waiting' && set.pedals() === null);

  pad.axes[2] = 0;                             // throttle half way
  set.poll();
  ok('pressing one hands the car over', set.state === 'driving' && near(set.pedals().throttle, 0.5, 0.03));
  pad.axes[5] = 1;
  set.poll();
  ok('and the brake reads too', near(set.pedals().brake, 1));
  pad.axes[6] = 1;
  set.poll();
  ok('as does the clutch, for the panel', near(set.clutch, 1));

  set.enabled = false;
  ok('switched off, it hands the car back', set.pedals() === null && set.state === 'off');
  set.enabled = true;

  set.startWizard();
  ok('while calibrating, it hands the car back', set.pedals() === null && set.state === 'mapping');
  set.cancelWizard();

  pads = [];
  set.poll();
  ok('unplugged, it hands the car back', set.pedals() === null && events.at(-1)?.type === 'disconnected');

  pads = [wheelPad()];
  set.poll();
  ok('pedals behind an unknown wheel connect but ask to be calibrated', set.connected && set.state === 'unmapped');
  ok('and say so', events.at(-1)?.ready === false);
}

console.log('\npedals mapped before they had their own set');
{
  store = { 'wheelhouse.wheels': JSON.stringify({ last: G29, maps: { [G29]: {
    steer: { pad: G29, kind: 'axis', index: 0 }, rotation: 900,
    throttle: { pad: G29, kind: 'axis', index: 2, rest: 1, full: -1 },
    brake: { pad: G29, kind: 'axis', index: 1, rest: 1, full: -1 } } } }) };
  const pads = [wheelPad()];
  const set = new PedalSet({ getPads: () => pads });
  set.poll();
  ok('are carried over rather than asked for again', set.mapped && set.mapping.throttle.index === 2);
}

console.log('\naiming the rim');
{
  const m = { steer: { pad: G29, kind: 'axis', index: 0, centre: 0.02, sign: -1 }, rotation: 900 };
  for (const deg of [-120, 0, 37, 135]) {
    const axis = steerToAxis(m, deg);
    const back = steerDegrees(m, [{ id: G29, axes: [axis] }]);
    ok(`aiming at ${deg}° lands on ${deg}°`, near(back, deg, 1e-9), `${back}`);
  }
  ok('a target past the axis is held at its end', steerToAxis(m, -5000) === 1);
}

console.log('\nwho is steering');
{
  const lead = new LeadTracker();
  let t = 0;
  ok('a rim left alone is not leading', !lead.update(10, null, t) && !lead.update(10.5, null, (t += 16)));
  ok('a rim moved by hand is', lead.update(14, null, (t += 16)));
  t += 1300;
  ok('and stops leading once let go', !lead.update(14, null, t));

  // Driven, and trailing its target the way a motor does.
  let rim = 0, target = 0, flagged = false;
  for (let i = 0; i < 120; i++) {
    target += 4;                         // 240°/s, a brisk drag
    rim += (target - rim) * 0.35;
    flagged ||= lead.update(rim, target, (t += 16));
  }
  ok('a rim chasing a fast target is not mistaken for a hand', !flagged);

  // Now a hand holds it still while the target keeps going.
  t += 2000;
  lead.reset();
  rim = 0; target = 0;
  const first = [];
  for (let i = 0; i < 40; i++) {
    target = Math.min(target + 2, 40);
    first.push(lead.update(rim, target, (t += 16)));
  }
  ok('a rim held against the spring hands the lead to the person', first.at(-1) === true);
  ok('but not on the first frame it is apart', first.indexOf(true) > first.findIndex((_, i) => i * 2 > 10));
}

console.log('\nthe two-way link');
{
  store = {};
  const pad = wheelPad();
  pad.axes[0] = 0;
  const sent = [];
  const native = {
    pads: [pad], moza: { state: 'absent', values: {} },
    canDrive: () => true,
    follow: (id, centre, strength) => sent.push({ id, centre, strength }),
    release: () => sent.push('release'),
  };
  let now = 0;
  const src = new WheelSource({ native, now: () => now });
  src.poll();
  ok('a force-feedback wheel can be driven', src.drivable);
  // Nothing has shown a wheel is fitted yet: the motor stays still.
  src.drive(30, 1 / 60);
  ok('with no wheel shown to be fitted, driving leaves the motor alone',
    !sent.some((x) => typeof x === 'object') && src.driving === null);
  src.confirmRim();
  ok('and starts at the bottom of the order, so anything else steering wins', src.priority === 2);

  src.drive(30, 1 / 60);
  ok('driving it moves the spring', typeof sent.at(-1) === 'object' && sent.at(-1).id === G29);
  ok('easing in, not jumping: the first frame moves it under a degree', src.driving > 0 && src.driving < 1, `${src.driving}`);
  const path = [src.driving];
  for (let i = 0; i < 40; i++) { src.drive(30, 1 / 60); path.push(src.driving); }
  ok('and gets there', near(src.driving, 30));
  const speeds = path.slice(1).map((p, i) => (p - path[i]) * 60);
  const jolts = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]) * 60);
  ok('speeding up and slowing down smoothly, never past the limit', Math.max(...jolts) <= 2400 + 1e-6,
    `peak ${Math.max(...jolts).toFixed(0)}°/s²`);
  ok('without overshooting', Math.max(...path) <= 30 + 1e-9);
  ok('aimed where the rim reads 30°', near(steerDegrees(src.mapping, [{ id: G29, axes: [sent.at(-1).centre] }]), 30, 1e-6));
  ok('the link says the rim follows', src.mode === 'following');

  // A hand stops the rim at 2° while the rig asks for 30°.
  pad.axes[0] = 2 / 360;
  for (let i = 0; i < 12; i++) { now += 16; src.poll(); src.drive(30, 0.016); }
  ok('holding the rim against it takes the lead', src.leading && src.priority === 30);
  ok('and the spring lets go', sent.at(-1) === 'release' && src.driving === null);
  ok('the link says the rim leads', src.mode === 'leading');
  ok('and the rim steers the rig', near(src.read().angle, 2 * Math.PI / 180));

  now += 2000; src.poll();
  ok('left alone, it drops back down the order', !src.leading && src.priority === 2);

  src.force.enabled = false;
  src.drive(30, 1 / 60);
  ok('with force off, nothing is sent', src.driving === null);
  src.force.enabled = true;

  native.canDrive = () => false;
  src.drive(30, 1 / 60);
  ok('a wheel without force feedback is never driven', src.driving === null);
}

console.log('\nshifting, from either side');
{
  const gate = new ShiftGate();
  ok('a paddle shifts', gate.accept(1, 'paddle', 1000));
  ok('the finger the camera saw pull it does not shift again', !gate.accept(1, 'fingers', 1120));
  ok('a second pull of the same paddle does', gate.accept(1, 'paddle', 1250));
  ok('a finger flick in the other direction does', gate.accept(-1, 'fingers', 1300));
  ok('and the same input again later always does', gate.accept(-1, 'paddle', 1700));
  ok('fingers on their own shift as before', new ShiftGate().accept(1, 'fingers', 0));
}

console.log('\nfingers while the real rim is steering');
{
  // The rim is leading — top of the order — and the hand tracker sits below
  // it. The tracker must still be read every frame, or the finger shifter
  // watches stale hands and the flaps stop working exactly when both hands
  // are on the wheel.
  const controller = new SteeringController();
  let handReads = 0;
  const hands = {
    name: 'camera', priority: 20, enabled: true, connect: async () => {},
    state: { holding: true },
    hands: { right: { fingers: { index: 0 } }, left: { fingers: { index: 0 } } },
    read() { handReads++; return { angle: 0.1, confidence: 1 }; },
  };
  const rim = { name: 'wheel', priority: 30, enabled: true, connect: async () => {}, read: () => ({ angle: 0.5, confidence: 1, snap: true }) };
  await controller.addSource(hands);
  await controller.addSource(rim);
  for (let i = 0; i < 10; i++) controller.update(1 / 60);
  ok('the rim wins the steering', controller.activeName === 'wheel');
  ok('and the hand tracker is still read every frame', handReads === 10, `${handReads} reads`);

  const shifts = [];
  const shifter = new Shifter(hands, { onShift: (d) => shifts.push(d) });
  let t = 0;
  // Extension is in hand-sizes: curled about 1.2, a straightened finger past 1.72.
  for (const ext of [1.2, 1.2, 2.0, 2.0, 2.0, 1.2, 1.2]) {
    hands.hands.right.fingers.index = ext;
    controller.update(1 / 60);
    shifter.update((t += 40));
  }
  ok('a right-finger flick shifts up while the rim steers', shifts.includes(1), JSON.stringify(shifts));
}

console.log('\nmapping just the paddles');
{
  const pad = wheelPad();
  const base = { ...defaultMapping(pad), steer: { pad: G29, kind: 'axis', index: 0, centre: 0.03, sign: -1 } };
  const wiz = new MappingWizard([pad], base, PADDLE_STEPS);
  ok('starts at the upshift, not the steering', wiz.current.key === 'up');
  press(pad, 7); wiz.feed([pad]); press(pad, 7, false); wiz.feed([pad]);
  press(pad, 6); wiz.feed([pad]); press(pad, 6, false); wiz.feed([pad]);
  wiz.skip(); wiz.skip();
  ok('learns both paddles', wiz.finished && wiz.mapping.up.index === 7 && wiz.mapping.down.index === 6);
  ok('and leaves the steering and its centre alone', wiz.mapping.steer.centre === 0.03 && wiz.mapping.steer.sign === -1);

  store = {};
  const shifts = [];
  const src = new WheelSource({ getPads: () => [pad], onShift: (d) => shifts.push(d) });
  src.poll();
  ok('an unmapped wheel says its paddles are not set', !src.paddlesMapped);
  src.startWizard(PADDLE_STEPS);
  press(pad, 7); src.poll(); press(pad, 7, false); src.poll();
  press(pad, 6); src.poll(); press(pad, 6, false); src.poll();
  src.skipStep(); src.skipStep();
  ok('mapped from the panel, it says so', src.paddlesMapped && !src.wizard);
  ok('and pulling them while mapping changed no gear', shifts.length === 0);
  press(pad, 7); src.poll(); press(pad, 7, false); src.poll();
  press(pad, 6); src.poll();
  ok('afterwards the real paddles shift up and down', JSON.stringify(shifts) === '[1,-1]', JSON.stringify(shifts));
  ok('and the mapping is remembered', JSON.parse(store['wheelhouse.wheels']).maps[G29].up.index === 7);
}

console.log('\na full turn each way');
{
  const { LOCK_DEGREES } = await import('../src/wheel/spec.js');
  ok('the rig locks at ±360°', LOCK_DEGREES === 360);
  const controller = new SteeringController({ lockDegrees: LOCK_DEGREES });
  let target = 0;
  await controller.addSource({ name: 'rim', priority: 1, connect: async () => {}, read: () => ({ angle: target * Math.PI / 180, confidence: 1, snap: true }) });
  for (const deg of [200, 300, -300, 359]) {
    target = deg;
    controller.update(1 / 60);
    ok(`the wheel holds ${deg}°`, near(controller.degrees, deg, 1e-9), `${controller.degrees}`);
  }
  target = 500;
  controller.update(1 / 60);
  ok('and stops at 360°', near(controller.degrees, 360, 1e-9));
  ok('which is full lock to the car', near(controller.normalised, 1, 1e-9));

  // A 720° base, rim at a full turn right, read and aimed one-to-one.
  const m = { steer: { pad: G29, kind: 'axis', index: 0, centre: 0, sign: 1 }, rotation: 720 };
  ok('a rim at a full turn reads 360°', near(steerDegrees(m, [{ id: G29, axes: [1] }]), 360));
  ok('and the rig can drive it there', near(steerToAxis(m, -360), -1));
}

console.log('\nas far as the wheel turns');
{
  ok('a 270° wheel holds the rig to ±135°', lockFor(360, 270) === 135);
  ok('a 540° wheel to ±270°', lockFor(360, 540) === 270);
  ok('a 900° wheel still stops at the rig\'s ±360°', lockFor(360, 900) === 360);
  ok('with no wheel, the rig\'s own ±360°', lockFor(360, null) === 360);

  const controller = new SteeringController({ lockDegrees: 360 });
  const keys = new KeyboardSource({ lock: controller.lock });
  await controller.addSource(keys);
  let target = 300;
  await controller.addSource({ name: 'rim', priority: 1, connect: async () => {}, read: () => ({ angle: target * Math.PI / 180, confidence: 1, snap: true }) });
  controller.update(1 / 60);
  ok('at ±360° the wheel reaches 300°', near(controller.degrees, 300, 1e-9));

  controller.setLockDegrees(lockFor(360, 270));
  ok('a 270° wheel plugged in pulls it back inside ±135° at once', near(controller.degrees, 135, 1e-9));
  controller.update(1 / 60);
  ok('and it cannot be asked past that', near(controller.degrees, 135, 1e-9));
  ok('full lock to the car is now the wheel\'s full lock', near(controller.normalised, 1, 1e-9));
  ok('the keys are held to the same limit', near(keys.lock, 135 * Math.PI / 180, 1e-12));

  target = -100;
  controller.update(1 / 60);
  ok('inside it, the wheel goes where it is asked', near(controller.degrees, -100, 1e-9));
  controller.setLockDegrees(360);
  ok('unplugged, the rig has its full turn back', near(controller.lock, 2 * Math.PI, 1e-12));

  store = {};
  const pad = wheelPad();
  const src = new WheelSource({ getPads: () => [pad] });
  src.poll();
  src.setRotation(540);
  ok('a connected wheel reports its rotation', src.rotation === 540);
  src.enabled = false;
  ok('a wheel switched off sets no limit', src.rotation === null);
}

console.log('\nfinding straight ahead, and both ends');
{
  /**
   * A motorised rim on a base set to `rotation`. Its axis ends at ±1, its
   * physical stops; it chases the spring's aim with a little lag and comes to
   * rest a hair off it, as friction leaves a real one. `offset` is where the
   * base's own middle really is, in raw units — a base whose centre is a few
   * degrees out has more travel one way than the other.
   */
  const rig = ({ rotation = 420, known = true, start = 13 / 210, id = G29, reversed = false } = {}) => {
    store = {};
    const pad = wheelPad(id);
    pad.axes[0] = start;
    const sent = [];
    let now = 0;
    const native = {
      pads: [pad], moza: { state: 'busy', holder: 'Boxflat', values: {} }, canDrive: () => true,
      follow: (id, centre, strength) => sent.push({ centre, strength }),
      release: () => sent.push('release'),
    };
    let centred = 0;
    const src = new WheelSource({ native, now: () => now, onCentred: () => centred++ });
    src.poll();
    src.confirmRim();
    if (known) src.setRotation(rotation);
    const step = (holdAt = null) => {
      now += 16;
      src.drive(null, 0.016);
      // A driver whose spring runs backwards sends the rim the other way.
      const sentAim = sent.filter((x) => x !== 'release').at(-1)?.centre;
      const aim = sentAim === undefined ? pad.axes[0] : reversed ? -sentAim : sentAim;
      const target = holdAt ?? aim + 0.0004;
      pad.axes[0] = Math.max(-1, Math.min(1, pad.axes[0] + (target - pad.axes[0]) * 0.3));
      src.poll();
    };
    return { pad, sent, src, step, centred: () => centred, now: () => now };
  };

  {
    const { pad, sent, src, step, centred } = rig();
    src.calibrateCentre();
    ok('calibrating starts by bringing the rim to the centre', src.mode === 'centring' && src.centring.phase === 'start');
    const order = [];
    let centredAtStart = null;
    let lowest = 1, highest = -1;
    for (let i = 0; i < 1500 && src.centring; i++) {
      step();
      const p = src.centring?.phase;
      if (p && order.at(-1) !== p) order.push(p);
      if (p === 'left' && centredAtStart === null) centredAtStart = centred();
      lowest = Math.min(lowest, pad.axes[0]); highest = Math.max(highest, pad.axes[0]);
    }
    ok('in order: centre, anticlockwise, clockwise, centre', order.join() === 'start,left,right,centre', order.join());
    ok('the rig centres with the rim before the sweep sets off', centredAtStart === 1);
    ok('to full lock anticlockwise', lowest <= -0.99, `${lowest.toFixed(3)}`);
    ok('then full lock clockwise', highest >= 0.99, `${highest.toFixed(3)}`);
    ok('then back to the middle', Math.abs(pad.axes[0]) < 0.01);
    ok('and finishes', !src.centring && src.centreResult?.ok === true, src.centreResult?.text);
    ok('never harder than half strength', sent.every((x) => x === 'release' || x.strength <= 0.5));
    ok('and lets go when done', sent.at(-1) === 'release');
    ok('the base\'s own centre is the new 0°', src.mapping.steer.centre === 0 && Math.abs(src.degrees) < 1);
    ok('both ends are recorded', src.mapping.ends && src.mapping.ends.left <= -0.99 && src.mapping.ends.right >= 0.99);
    const t = src.travel;
    ok('which on a 420° wheel is about 210° each way', Math.abs(t.min + 210) < 2 && Math.abs(t.max - 210) < 2,
      `${t.min.toFixed(1)}° to ${t.max.toFixed(1)}°`);
    ok('and says so', /Calibrated: −21\d° anticlockwise to \+2\d\d° clockwise/.test(src.centreResult.text), src.centreResult.text);
    ok('and again at the end', centred() === 2);
    ok('and it is remembered', JSON.parse(store['wheelhouse.wheels']).maps[G29].ends.right >= 0.99);
    const r = lockRange(360, src.mapping);
    ok('the rig now stops where the rim does, each way', Math.abs(r.min - t.min) < 1e-9 && Math.abs(r.max - t.max) < 1e-9);
  }

  {
    // Turned by hand, straight ahead is where the driver says it is. If that
    // is not the base's own middle — 0.05 off here — the ends come out
    // uneven either side of it, as they really are.
    const c = new SweepCalibration({ drivable: false, now: 0 });
    let t = 0;
    for (const raw of [0, -1, 1, 0.05]) {
      for (let i = 0; i < 80; i++) c.update(raw, (t += 16));
    }
    ok('an off-centre base gives uneven travel each side', c.phase === 'done' && near(c.range(420).min, -220.5, 1e-9) && near(c.range(420).max, 199.5, 1e-9),
      `${c.range(420)?.min} to ${c.range(420)?.max}`);
    const m = { steer: { pad: G29, kind: 'axis', index: 0, centre: 0.05, sign: 1 }, rotation: 420, ends: { left: -1, right: 1 } };
    const range = lockRange(360, m);
    ok('and the rig follows it: further one way than the other', near(range.min, -220.5, 1e-9) && near(range.max, 199.5, 1e-9));
  }

  {
    const { sent, src, step, centred } = rig();
    src.calibrateCentre();
    for (let i = 0; i < 1500 && src.centring; i++) step(13 / 210);       // a hand holds it where it is
    ok('a rim that never gets where it is sent stops the calibration', src.centreResult?.ok === false && /did not get where/.test(src.centreResult.text));
    ok('leaving the old centre and ends alone', src.mapping.steer.centre === 0 && !src.mapping.ends && centred() === 0);
    ok('and letting go of the rim', sent.at(-1) === 'release');
  }

  {
    const { src } = rig();
    src.calibrateCentre();
    src.cancelCentre();
    ok('cancelled, nothing changes', !src.centring && src.mapping.steer.centre === 0 && src.centreResult?.ok === false);
  }

  {
    // Your setup: a Moza with Boxflat holding its port. Calibrate asks the
    // base anyway — alongside Boxflat — and sweeps on the exact answer.
    const { src, step } = rig({ known: false, id: R3 });
    const asked = [];
    src.native.mozaRead = (names) => asked.push(names);
    src.native.moza = { state: 'busy', holder: 'Boxflat', values: {} };
    src.calibrateCentre();
    ok('with the rotation unknown, Calibrate does not sweep on a guess', !src.centring && !!src.awaitingBase);
    ok('it asks the base, without asking for Boxflat to be closed', asked.length === 1 && asked[0].includes('rotation')
      && !/close Boxflat/.test(src.awaitingMessage), src.awaitingMessage);
    // The answer comes back while Boxflat still holds the port.
    src.native.moza = { state: 'busy', holder: 'Boxflat', values: { rotation: 472 } };
    step();
    ok('the base\'s exact rotation is taken, Boxflat open', src.rotation === 472 && src.mapping.rotationFrom === 'base');
    ok('and the sweep starts by itself, from the centre', !src.awaitingBase && src.centring?.phase === 'start');
    for (let i = 0; i < 1500 && src.centring; i++) step();
    const t = src.travel;
    ok('ending at ±236°, not ±360°', src.centreResult?.ok && Math.abs(t.min + 236) < 2 && Math.abs(t.max - 236) < 2,
      `${t?.min.toFixed(1)}° to ${t?.max.toFixed(1)}°`);
    ok('and the rig stops at the rim\'s ends', Math.abs(lockRange(360, src.mapping).max - t.max) < 1e-9);
  }

  {
    // A base that never answers: measure instead of waiting forever.
    const { src, step } = rig({ known: false, id: R3 });
    src.native.mozaRead = () => {};
    src.native.moza = { state: 'busy', holder: 'Boxflat', values: {} };
    src.calibrateCentre();
    for (let i = 0; i < 400; i++) step();
    ok('a base that never answers falls back to measuring', !src.awaitingBase && src.mode === 'measuring');
  }

  {
    // Any other wheel with an unknown rotation: measured first, then the sweep.
    const { src, step, pad } = rig({ known: false });
    src.calibrateCentre();
    ok('a wheel that cannot say its rotation is measured first', src.mode === 'measuring');
  }

  {
    // A force-feedback driver whose spring runs backwards: sent to the left
    // lock, the rim goes right. The sweep notices, turns it round, finishes.
    const { src, step, pad, sent } = rig({ reversed: true });
    src.calibrateCentre();
    let lowest = 1, highest = -1;
    for (let i = 0; i < 2500 && src.centring; i++) {
      step();
      lowest = Math.min(lowest, pad.axes[0]); highest = Math.max(highest, pad.axes[0]);
    }
    ok('a motor that runs backwards is found out and the sweep still finishes', src.centreResult?.ok === true, src.centreResult?.text);
    ok('having reached both locks', lowest <= -0.99 && highest >= 0.99);
    ok('and back at the middle', Math.abs(pad.axes[0]) < 0.06);
    ok('the direction is remembered', src.mapping.ffSign === -1);
    // From now on the rim follows the rig the right way round.
    src.force.enabled = true;
    for (let i = 0; i < 120; i++) { src.drive(90, 1 / 60); }
    const aimed = sent.filter((x) => x !== 'release').at(-1).centre;
    ok('and the rim is then driven the right way to follow the rig', near(-aimed, 90 / 210, 1e-6), `${aimed}`);
  }

  {
    // Start-up: ±360° assumed, even with the base able to say 472°; learned
    // on Calibrate; remembered after that.
    const { src, step } = rig({ known: false, id: R3 });
    src.native.mozaRead = () => {};
    src.native.moza = { state: 'busy', holder: 'Boxflat', values: { rotation: 472 } };
    for (let i = 0; i < 30; i++) step();
    ok('at start the wheel is assumed to turn ±360°, whatever the base could say',
      src.rotation === 720 && !src.rotationKnown && lockRange(360, src.mapping).max === 360);
    src.calibrateCentre();
    for (let i = 0; i < 1500 && (src.centring || src.awaitingBase); i++) step();
    ok('Calibrate learns the real range', src.rotation === 472 && lockRange(360, src.mapping).max < 240);
    // A restart: a new source on the same stored mapping.
    const again = new WheelSource({ getPads: () => src.pads, native: src.native });
    again.poll();
    ok('and the next start remembers it', again.rotation === 472 && again.rotationKnown
      && Math.abs(lockRange(360, again.mapping).max - 236) < 2);
  }

  {
    // Values stored by older versions start out assumed again until calibrated.
    store = { 'wheelhouse.wheels': JSON.stringify({ last: null, maps: {
      [R3]: { steer: { pad: R3, kind: 'axis', index: 0, centre: 0, sign: 1 }, rotation: 900 } } }) };
    const pad = wheelPad(R3);
    const old = new WheelSource({ getPads: () => [pad] });
    old.poll();
    ok('an old 900° guess becomes the ±360° assumption', old.rotation === 720 && !old.rotationKnown);
    store = { 'wheelhouse.wheels': JSON.stringify({ last: null, maps: {
      [R3]: { steer: { pad: R3, kind: 'axis', index: 0, centre: 0, sign: 1 }, rotation: 472, rotationFrom: 'base' } } }) };
    const read = new WheelSource({ getPads: () => [pad] });
    read.poll();
    ok('as does a base reading taken without a calibration', read.rotation === 720);
    store = { 'wheelhouse.wheels': JSON.stringify({ last: null, maps: {
      [R3]: { steer: { pad: R3, kind: 'axis', index: 0, centre: 0, sign: 1 }, rotation: 450, rotationFrom: 'set' } } }) };
    const typed = new WheelSource({ getPads: () => [pad] });
    typed.poll();
    ok('but one typed in is kept', typed.rotation === 450 && typed.rotationKnown);
  }

  {
    // How long they take, on a 472° wheel like the R3.
    let { src, step, now } = rig({ rotation: 472, start: 0.3 });
    src.calibrateCentre();
    const t0 = now();
    while (src.centring && now() - t0 < 30000) step();
    const cal = (now() - t0) / 1000;
    ok('a full calibration takes under 7 s', src.centreResult?.ok && cal < 7, `${cal.toFixed(1)} s`);
    ({ src, step, now } = rig({ rotation: 472, start: 0 }));
    src.pads[0].axes[0] = 0.8;
    src.centre();
    const t1 = now();
    while (src.returning && now() - t1 < 30000) step();
    const cen = (now() - t1) / 1000;
    ok('centring from three-quarters lock takes under 1.5 s', src.centreResult?.ok && cen < 1.5, `${cen.toFixed(1)} s`);
  }

  {
    // The Centre button: back to 0°, changing nothing about the calibration.
    const { src, step, pad, sent, centred } = rig();
    src.mapping = { ...src.mapping, steer: { ...src.mapping.steer, centre: 0.01 }, ends: { left: -1, right: 1 } };
    const before = JSON.stringify({ c: src.mapping.steer.centre, e: src.mapping.ends, r: src.rotation });
    pad.axes[0] = 0.6;                                   // the rim well over to the right
    ok('Centre starts', src.centre() === true && src.mode === 'returning');
    for (let i = 0; i < 500 && src.returning; i++) step();
    ok('the motor brings the rim back to straight ahead', Math.abs(pad.axes[0] - 0.01) < 1 / 210, `${pad.axes[0].toFixed(4)}`);
    ok('the rig centres with it', centred() === 1 && src.centreResult?.ok === true);
    ok('and lets go', sent.at(-1) === 'release');
    ok('without changing the centre, the ends or the rotation',
      JSON.stringify({ c: src.mapping.steer.centre, e: src.mapping.ends, r: src.rotation }) === before);
  }

  {
    const { src, step, pad, sent, centred } = rig();
    pad.axes[0] = 0.6;
    src.centre();
    for (let i = 0; i < 600 && src.returning; i++) step(0.6);   // a hand holds it there
    ok('a rim that is held does not come back, and says so', src.centreResult?.ok === false && /did not come back/.test(src.centreResult.text));
    ok('the motor lets go', sent.at(-1) === 'release' && centred() === 0);
  }

  {
    const { src } = rig();
    src.calibrateCentre();
    ok('Centre waits while a calibration is running', src.centre() === false && !src.returning);
  }

  {
    // A wheel the rig cannot turn: Centre takes where it is held as straight ahead.
    store = {};
    const pad = wheelPad();
    pad.axes[0] = 0.04;
    let centred = 0;
    const src = new WheelSource({ getPads: () => [pad], onCentred: () => centred++ });
    src.poll();
    ok('without force feedback, Centre takes the rim as it is held as straight ahead',
      src.centre() === true && src.mapping.steer.centre === 0.04 && centred === 1);
    src.poll();
    ok('so it reads 0°', near(src.degrees, 0, 1e-9));
  }

  {
    // A wheel the rig cannot turn: the driver does the sweep.
    store = {};
    const pad = wheelPad();
    let now = 0;
    const src = new WheelSource({ getPads: () => [pad], now: () => now });
    src.poll();
    src.setRotation(540);
    src.calibrateCentre();
    ok('a wheel without force feedback asks for the sweep by hand, straight ahead first',
      src.centring.phase === 'start' && /Hold the rim straight ahead/.test(src.centring.message));
    const hold = (v, ms) => { for (let e = 0; e < ms; e += 16) { now += 16; pad.axes[0] = v; src.poll(); } };
    hold(0, 1200);
    ok('then anticlockwise', src.centring?.phase === 'left' && /all the way anticlockwise/.test(src.centring.message));
    hold(-1, 1200);
    ok('a held stop anticlockwise moves it on', src.centring?.phase === 'right');
    hold(1, 1200);
    hold(0.4, 1200);
    ok('not centred while it is still well off the middle', src.centring?.phase === 'centre');
    hold(0.01, 1200);
    ok('then straight ahead finishes it', !src.centring && src.centreResult.ok && near(src.mapping.steer.centre, 0.01, 1e-12));
  }
}

console.log('\nthe neutral and reverse buttons');
{
  store = {};
  const pad = wheelPad();
  let now = 0;
  const gears = [];
  const src = new WheelSource({ getPads: () => [pad], now: () => now, onGear: (g) => gears.push(g) });
  src.poll();
  src.mapping = { ...src.mapping, neutral: { pad: G29, kind: 'button', index: 9 }, reverse: { pad: G29, kind: 'button', index: 10 } };
  press(pad, 9); src.poll(); now += 150; src.poll(); press(pad, 9, false); now += 16; src.poll();
  ok('a press of the neutral button selects neutral', JSON.stringify(gears) === '["neutral"]', JSON.stringify(gears));
  gears.length = 0;
  press(pad, 9); src.poll();
  for (let i = 0; i < 50; i++) { now += 16; src.poll(); }
  ok('holding it selects reverse, once', JSON.stringify(gears) === '["reverse"]', JSON.stringify(gears));
  press(pad, 9, false); now += 16; src.poll();
  ok('and letting go after the hold does not then select neutral', gears.length === 1);
  gears.length = 0;
  press(pad, 10); src.poll(); press(pad, 10, false); src.poll();
  ok('a reverse button of its own selects reverse', JSON.stringify(gears) === '["reverse"]');
}

console.log('\nhow far this wheel really turns');
{
  /** A rim on a wheel set to `rotation`, turned to `deg`: the axis reads a fraction of its own travel. */
  const axisAt = (deg, rotation) => clampAxis(deg / (rotation / 2));
  const clampAxis = (v) => Math.max(-1, Math.min(1, v));

  // The bug: a wheel set to 420° read as the 900° default.
  const assumed = { steer: { pad: G29, kind: 'axis', index: 0, centre: 0, sign: 1 }, rotation: 900 };
  ok('a 420° wheel at full lock, read as 900°, looks like 450° — the mistake',
    near(steerDegrees(assumed, [{ id: G29, axes: [axisAt(210, 420)] }]), 450));

  // Measuring it: hold straight, then half a turn.
  const measure = (rotation, { quarter = false, wobble = 0 } = {}) => {
    const m = new RotationMeasurement({ now: 0 });
    let t = 0;
    const hold = (deg, ms) => { for (let e = 0; e < ms; e += 50) { t += 50; m.update(axisAt(deg + (Math.random() - 0.5) * wobble, rotation), t); } };
    hold(0, 2000);
    if (!quarter) hold(180, 2500); else { hold(rotation / 2, 2500); hold(90, 2500); }
    return m;
  };
  for (const rotation of [420, 540, 900, 1080]) {
    const m = measure(rotation, { wobble: 0.6 });
    ok(`a ${rotation}° wheel measures as ${rotation}°`, m.phase === 'done' && m.result === rotation, `${m.phase} ${m.result}`);
  }
  // Set to 270°: half a turn is past its lock, so it asks for a quarter turn.
  const short = measure(270, { quarter: true });
  ok('a wheel that stops before half a turn is measured from a quarter turn', short.phase === 'done' && short.result === 270,
    `${short.phase} ${short.result}`);
  const passing = new RotationMeasurement({ now: 0 });
  let t = 0;
  for (; t < 2000; t += 50) passing.update(0, t);
  for (let deg = 0; deg <= 180; deg += 3) passing.update(axisAt(deg, 420), (t += 50));
  ok('turning through without stopping measures nothing yet', passing.phase === 'half');
  const quit = new RotationMeasurement({ now: 0 });
  for (let i = 0; i < 2000; i++) quit.update(Math.sin(i) * 0.5, i * 50);
  ok('a rim that never holds still gives up, changing nothing', quit.phase === 'failed' && quit.result === null);

  // End to end: the source measures it and the rig's lock follows.
  store = {};
  const pad = wheelPad();
  let now = 0;
  const src = new WheelSource({ getPads: () => [pad], now: () => now });
  src.poll();
  ok('until it is known, the rotation is assumed (±360°) and flagged', !src.rotationKnown && src.rotation === 720);
  ok('and the rig would allow ±360°', lockFor(360, src.rotation) === 360);
  src.measureRotation();
  ok('while measuring, the rim does not steer the rig', src.read() === null && src.mode === 'measuring');
  const hold = (deg, ms) => { for (let e = 0; e < ms; e += 50) { now += 50; pad.axes[0] = axisAt(deg, 420); src.poll(); } };
  hold(0, 2000); hold(180, 2500);
  ok('measured, the rotation is 420°', src.rotation === 420 && src.rotationKnown && src.measureResult?.ok);
  ok('so the rig now stops at ±210°, where the rim does', lockFor(360, src.rotation) === 210);
  pad.axes[0] = axisAt(210, 420); src.poll();
  ok('and full lock on the rim reads 210°', near(src.degrees, 210, 1e-9));
  ok('remembered', JSON.parse(store['wheelhouse.wheels']).maps[G29].rotationFrom === 'measured');

  src.setRotation(450);
  ok('typing a rotation in counts as known too', src.rotation === 450 && src.rotationKnown);
  src.setRotation(20);
  ok('but nonsense is ignored', src.rotation === 450);
}

console.log('\nrim safety: the motor never turns a base with no wheel on it');
{
  const MOZA = 'Gudsen R3 Racing Wheel and Pedals (Vendor: 346e Product: 0005)';
  const make = ({ guard = true } = {}) => {
    const pad = wheelPad(MOZA);
    const sent = [];
    let probes = 0;
    let now = 0;
    const native = {
      pads: [pad], moza: { state: 'absent', values: {} }, canDrive: () => true, rim: null,
      follow: (id, centre, strength) => sent.push({ centre, strength }),
      release: () => sent.push('release'),
      probeRim: () => { probes++; },
    };
    const shifts = [];
    const src = new WheelSource({ native, now: () => now, onShift: (d) => shifts.push(d) });
    src.rimGuard = guard;
    src.poll();
    src.setRotation(472);
    const tick = (ms = 16) => { now += ms; src.poll(); src.drive(null, ms / 1000); };
    const driven = () => sent.some((x) => typeof x === 'object');
    return { pad, sent, src, native, tick, driven, shifts, probes: () => probes, at: () => now, setNow: (t) => { now = t; } };
  };

  {
    const { src, tick, driven, probes } = make();
    ok('nothing is known about a rim when the base appears', src.rim.state === 'unknown' && !src.motorAllowed);
    {
      src.centre();
      for (let i = 0; i < 10; i++) tick();
      ok('Centre with no wheel shown fitted asks instead of moving', !!src.rimCheck && src.mode === 'checking' && !src.returning);
      ok('and the motor is never driven', !driven());
      ok('a Moza base is asked, read-only, whether a rim is on it', probes() === 1);
    }
  }

  {
    const { pad, src, tick, driven } = make();
    src.calibrateCentre();
    tick();
    ok('Calibrate is held the same way', !!src.rimCheck && !src.centring && !driven());
    press(pad, 3);
    tick();
    ok('pressing any button on the wheel shows it is fitted', src.rim.state === 'present' && src.rim.via === 'button');
    ok('and the calibration then goes ahead by itself', !src.rimCheck && !!(src.centring || src.awaitingBase));
    for (let i = 0; i < 5; i++) tick();
    ok('with the motor now driving', driven());
  }

  {
    const { pad, src, tick, shifts } = make();
    src.mapping = { ...src.mapping, up: { pad: pad.id, kind: 'button', index: 5 } };
    src.centre();
    tick();
    press(pad, 5);
    tick();
    ok('the paddle pulled to show the wheel is fitted does not also change gear', shifts.length === 0);
  }

  {
    const { src, tick, driven } = make();
    src.centre();
    tick();
    src.confirmRim();
    tick();
    ok('saying a wheel is fitted lets Centre go ahead', !!src.returning && src.rim.via === 'user');
    for (let i = 0; i < 5; i++) tick();
    ok('and drive the motor', driven());
  }

  {
    const { src, tick } = make();
    src.centre();
    tick();
    src.cancelRimCheck();
    ok('cancelling leaves the motor alone and says so', !src.rimCheck && /not moved/.test(src.centreResult.text));
  }

  {
    const { src, tick, setNow, at } = make();
    src.centre();
    tick();
    setNow(at() + 31000);
    tick();
    ok('a check nobody answers gives up after half a minute', !src.rimCheck && /not moved/.test(src.centreResult.text));
  }

  {
    const { src, native, tick, sent } = make();
    native.rim = { present: true, at: 1 };
    tick();
    ok('a rim that answers the base is known to be fitted', src.rim.state === 'present' && src.rim.via === 'serial');
    src.centre();
    for (let i = 0; i < 3; i++) tick();
    ok('so Centre goes straight ahead', !!src.returning);
    native.rim = { present: false, at: 2 };
    tick();
    ok('if it stops answering mid-move, the move stops', !src.returning && src.rim.state === 'absent');
    ok('and the motor is released', sent.at(-1) === 'release' || sent.includes('release'));
    ok('saying why', /taken off/.test(src.centreResult.text));
  }

  {
    const { pad, src, tick, sent } = make();
    src.confirmRim();
    src.centre();
    for (let i = 0; i < 3; i++) tick();
    // A bare rotor whipping round: 60° of rim every frame.
    for (let i = 0; i < 4; i++) { pad.axes[0] += 60 / 236; tick(); }
    ok('a rotor spinning far faster than it is driven is released at once', !src.returning && sent.includes('release'));
    ok('and has to be shown a wheel again before the next move', src.rim.state === 'unknown' && !src.motorAllowed);
    ok('saying what happened', /far faster/.test(src.centreResult.text));
  }

  {
    const { src, tick, driven } = make();
    src.drive(30, 1 / 60);
    tick();
    ok('turning the rim to match the rig waits for a wheel too', src.driving === null && !driven());
  }

  {
    const { src, tick, driven } = make({ guard: false });
    src.centre();
    for (let i = 0; i < 3; i++) tick();
    ok('with the check turned off, Centre drives without asking', !src.rimCheck && !!src.returning && driven());
  }

  {
    const { pad, src, tick } = make();
    press(pad, 2);
    tick();
    ok('a wheel shown fitted is remembered', src.motorAllowed);
    src.native.pads = [];
    tick();
    src.native.pads = [pad];
    tick();
    ok('until the base reconnects, when it must be shown again', src.rim.state === 'unknown');
  }
}

console.log(failures === 0 ? '\nall wheel checks passed\n' : `\n${failures} wheel check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
