/**
 * Physical steering wheels — recognising one, and turning its raw axes into
 * an angle, two pedals and a pair of paddles.
 *
 * Everything here is pure: it takes plain snapshots of the Gamepad API
 * (`{id, mapping, axes, buttons}`) and never touches `navigator`, so it runs
 * in Node against stubs. `WheelSource` is the part that polls real hardware.
 *
 * Wheels are not standardised. The Gamepad API defines a "standard" layout
 * for console-style pads and nothing at all for wheels, so which axis is the
 * throttle — and whether it reads +1 or −1 at rest — differs by make, model,
 * driver and operating system. Rather than guess a table of layouts that
 * cannot be checked without the hardware, the steering axis defaults to 0
 * (which every wheel seen so far uses) and the rest is learned: the mapping
 * wizard asks for one movement at a time and records whichever input moved.
 */
const STORE_KEY = 'wheelhouse.wheels';

/** Names that are a wheel, from the id string the browser reports. */
const WHEEL_NAME = /wheel|racing|driving force|\bg2[579]\b|\bg9[02]\d\b|\bg pro\b|momo|\bt150\b|\bt248\b|\bt300\b|\btmx\b|\bt-gt\b|\bts-?xw\b|\bts-?pc\b|\bt818\b|fanatec|\bcsl\b|clubsport|podium|moza|simagic|simucube|asetek|cammus/i;

/**
 * Vendors that only make wheels and pedals, so the id alone is enough.
 * Logitech and Thrustmaster are not here — both also make pads and
 * joysticks — and are matched by product id or name instead.
 */
const WHEEL_VENDORS = new Set(['0eb7' /* Fanatec */, '346e' /* Moza */]);

/** Logitech's wheel product ids: Driving Force, G25, G27, G29, G920, G923, G PRO. */
const LOGITECH_WHEELS = new Set([
  'c294', 'c298', 'c299', 'c29a', 'c29b', 'c24f', 'c260', 'c261', 'c262',
  'c266', 'c267', 'c26d', 'c26e', 'c268', 'c272',
]);

/**
 * What a wheel is taken to turn, lock to lock, until it has been calibrated:
 * the rig's own full range, ±360°. Calibration replaces it with the wheel's
 * real one, and that is remembered from then on.
 */
export const ASSUMED_ROTATION = 720;

/** Rotation choices offered in the settings, in degrees lock to lock. */
export const ROTATIONS = [180, 270, 360, 540, 720, 900, 1080];

/**
 * Pulls vendor and product ids out of a gamepad id.
 *
 * Chromium writes "Name (Vendor: 046d Product: c24f)", Firefox
 * "046d-c24f-Name". Anything else gets nulls, and the name match still works.
 */
export function parseIds(id = '') {
  let m = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(id);
  if (!m) m = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (!m) return { vendor: null, product: null };
  return { vendor: m[1].toLowerCase().padStart(4, '0'), product: m[2].toLowerCase().padStart(4, '0') };
}

/** The human part of a gamepad id, without the bracketed ids around it. */
export function displayName(id = '') {
  const name = id
    .replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:[^)]*\)\s*$/i, '')
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    // Moza's hardware reports its maker's company name, which nobody knows it by.
    .replace(/^Gudsen\b/i, 'Moza')
    .trim();
  return name || 'game controller';
}

export function isLikelyWheel(id = '') {
  const { vendor, product } = parseIds(id);
  if (vendor && WHEEL_VENDORS.has(vendor)) return true;
  if (vendor === '046d' && LOGITECH_WHEELS.has(product)) return true;
  return WHEEL_NAME.test(id);
}

/**
 * What a wheel does before anyone has mapped it: steers on axis 0, which
 * every wheel seen so far uses. A console-style pad has a standard layout,
 * so its bumpers can be bound as paddles straight away, and its stick gets a
 * short rotation so that full deflection is full lock. Pedals are their own
 * device, with their own defaults — see `defaultPedals`.
 */
export function defaultMapping(pad) {
  const steer = { pad: pad.id, kind: 'axis', index: 0, centre: 0, sign: 1 };
  if (pad.mapping === 'standard' && !isLikelyWheel(pad.id)) {
    return {
      steer,
      up: { pad: pad.id, kind: 'button', index: 5 },
      down: { pad: pad.id, kind: 'button', index: 4 },
      // A pad has no rim to calibrate: full stick is full lock, by design.
      rotation: 270,
      rotationFrom: 'pad',
    };
  }
  return { steer, up: null, down: null, neutral: null, reverse: null,
           rotation: ASSUMED_ROTATION,
           // Assumed until the wheel is calibrated, measured or set.
           rotationFrom: 'default' };
}

/* ── pedals ─────────────────────────────────────────────────────────── */

/** Names that are a pedal set in their own right, rather than pedals behind a wheel. */
const PEDAL_NAME = /pedal/i;

/**
 * Where Moza puts its pedals, by evdev axis code, as Boxflat records them
 * (boxflat/hid_handler.py). Through a base — the R3 and R5 bundles — they are
 * Z, RZ and THROTTLE; a pedal set on its own USB cable reports RX, RY, RZ.
 * Both rest at the bottom of their range and read the top when floored.
 */
const ABS = { Z: 0x02, RX: 0x03, RY: 0x04, RZ: 0x05, THROTTLE: 0x06 };
const MOZA_BASE = /gudsen (moza )?r[0-9]{1,2} (pro base|ultra base|base|racing wheel and pedals)/i;
const MOZA_PEDALS = /gudsen moza (srp|sr-p|crp)[0-9]? pedals/i;

export const PEDAL_KEYS = ['throttle', 'brake', 'clutch'];

export function isLikelyPedals(id = '') {
  return PEDAL_NAME.test(id);
}

/**
 * What a device's pedals are before anyone has mapped them, or all null.
 *
 * Only layouts that are known: Moza's, by axis code, and a console pad's
 * triggers. Anything else is left unmapped rather than guessed, because a
 * pedal guessed wrong reads as half pressed at rest, and a throttle that is
 * open before the driver touches it is worse than one that has to be mapped.
 */
export function defaultPedals(pad) {
  const none = { throttle: null, brake: null, clutch: null };
  if (!pad) return none;
  if (pad.mapping === 'standard' && !isLikelyWheel(pad.id) && !isLikelyPedals(pad.id)) {
    return { throttle: { pad: pad.id, kind: 'button', index: 7 },
             brake: { pad: pad.id, kind: 'button', index: 6 }, clutch: null };
  }
  const layout = MOZA_PEDALS.test(pad.id) ? { throttle: ABS.RX, brake: ABS.RY, clutch: ABS.RZ }
    : MOZA_BASE.test(pad.id) ? { throttle: ABS.Z, brake: ABS.RZ, clutch: ABS.THROTTLE }
      : null;
  // Axis codes only come from the desktop helper. The Gamepad API numbers
  // axes its own way, so without codes a layout cannot be placed safely.
  if (!layout || !Array.isArray(pad.codes)) return none;
  const bind = (code) => {
    const index = pad.codes.indexOf(code);
    return index < 0 ? null : { pad: pad.id, kind: 'axis', index, rest: -1, full: 1 };
  };
  return { throttle: bind(layout.throttle), brake: bind(layout.brake), clutch: bind(layout.clutch) };
}

/** Whether `defaultPedals` knows this device, so it can drive with no setup. */
export function hasPedalLayout(pad) {
  const d = defaultPedals(pad);
  return !!(d.throttle || d.brake);
}

/**
 * Picks the device the pedals are on.
 *
 * The one chosen last wins if it is plugged in. Then a device that is a pedal
 * set, then a wheel — most wheels' pedals plug into the base and report
 * through it. Never a plain pad on its own initiative, for the same reason
 * as `chooseDevice`.
 */
export function choosePedalDevice(pads, last) {
  const live = pads.filter(Boolean);
  const ids = live.map((p) => p.id);
  if (last && ids.includes(last)) return last;
  return live.find((p) => isLikelyPedals(p.id))?.id
    ?? live.find((p) => isLikelyWheel(p.id))?.id
    ?? null;
}

/* ── reading bindings ───────────────────────────────────────────────── */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const padFor = (binding, pads) => pads.find((p) => p?.id === binding?.pad) ?? null;

export const buttonValue = (b) => (b == null ? 0 : typeof b === 'number' ? b : (b.value || (b.pressed ? 1 : 0)));

/**
 * The wheel's angle in degrees, positive to the right, or null if its
 * device is not there. One-to-one with the rim: `rotation` is the wheel's
 * lock-to-lock range, so an axis at ±1 is ±rotation/2.
 */
export function steerDegrees(mapping, pads) {
  const b = mapping?.steer;
  const pad = padFor(b, pads);
  if (!pad || b.kind !== 'axis') return null;
  const v = pad.axes[b.index];
  if (typeof v !== 'number') return null;
  return (v - (b.centre ?? 0)) * (b.sign ?? 1) * (mapping.rotation / 2);
}

/** Below this much travel a pedal reads zero, so a resting foot cannot creep the car. */
export const PEDAL_DEADZONE = 0.04;

/** A pedal as 0…1, or null if it is unbound or its device is not there. */
export function pedalValue(binding, pads) {
  const pad = padFor(binding, pads);
  if (!pad) return null;
  let x;
  if (binding.kind === 'button') {
    x = buttonValue(pad.buttons[binding.index]);
  } else {
    const v = pad.axes[binding.index];
    if (typeof v !== 'number') return null;
    const span = binding.full - binding.rest;
    x = span === 0 ? 0 : (v - binding.rest) / span;
  }
  x = clamp(x, 0, 1);
  return x <= PEDAL_DEADZONE ? 0 : (x - PEDAL_DEADZONE) / (1 - PEDAL_DEADZONE);
}

/**
 * How many times a button has been pressed since its device appeared, where
 * the device keeps count (the desktop helper does), or null where it does
 * not (the browser's Gamepad API only ever says what is down right now).
 */
export function buttonPresses(binding, pads) {
  const pad = padFor(binding, pads);
  if (!pad || binding.kind !== 'button' || !Array.isArray(pad.presses)) return null;
  return pad.presses[binding.index] ?? null;
}

export function buttonPressed(binding, pads) {
  const pad = padFor(binding, pads);
  if (!pad || binding.kind !== 'button') return false;
  return buttonValue(pad.buttons[binding.index]) >= 0.5;
}

/* ── the mapping wizard ─────────────────────────────────────────────── */

export const WIZARD_STEPS = [
  { key: 'steer', prompt: 'From straight ahead, turn the wheel a quarter turn to the right.' },
  { key: 'up', prompt: 'Pull the upshift paddle (usually the right one).' },
  { key: 'down', prompt: 'Pull the downshift paddle (usually the left one).' },
  { key: 'neutral', prompt: 'Press the button you want for neutral — holding it will select reverse. Or skip.' },
  { key: 'reverse', prompt: 'Press a button for reverse, or skip: holding neutral selects it anyway.' },
];

/** Just the paddles and gear buttons, for a wheel whose steering is already right. */
export const PADDLE_STEPS = WIZARD_STEPS.filter((s) => s.key !== 'steer');

/**
 * Pedals ask to be floored, because the step also records how far each one
 * really travels: plenty never reach the end of their axis, and a throttle
 * that tops out at 92% is a car that is never at full power.
 */
export const PEDAL_STEPS = [
  { key: 'throttle', prompt: 'Press the throttle all the way to the floor, then let it go.' },
  { key: 'brake', prompt: 'Press the brake as hard as you would in a stop, then let it go.' },
  { key: 'clutch', prompt: 'Press the clutch all the way down, then let it go — or skip if there is none.' },
];

/** How far an axis has to move to count, per kind of step. */
const STEER_MOVE = 0.12;      // ~54° on a 900° wheel
const PEDAL_MOVE = 0.5;
/** How close to its starting point everything must be before the next step listens. */
const SETTLED = 0.15;
/**
 * A recorded pedal's full travel is pulled in this much, so a press as hard
 * as the one it learned from reliably reads 100% rather than 99.
 */
const FULL_MARGIN = 0.03;

/**
 * How far another pedal may move while one is being calibrated before the
 * round is thrown out — 15% of its travel. A foot resting on a pedal moves it
 * less than this; a second pedal actually being pressed moves it far more.
 */
const CROSSTALK = 0.3;

const LABEL = { throttle: 'throttle', brake: 'brake', clutch: 'clutch' };

/** evdev's axis names, for telling the driver which input a pedal turned out to be. */
const ABS_NAMES = { 0: 'X', 1: 'Y', 2: 'Z', 3: 'RX', 4: 'RY', 5: 'RZ', 6: 'THROTTLE', 7: 'RUDDER',
  8: 'WHEEL', 9: 'GAS', 10: 'BRAKE', 16: 'HAT0X', 17: 'HAT0Y' };

/** "ABS_Z", "axis 3" or "button 7": what a binding reads, in words. */
export function inputLabel(binding, pads = []) {
  if (!binding) return 'unset';
  if (binding.kind === 'button') return `button ${binding.index + 1}`;
  const code = pads.find((p) => p?.id === binding.pad)?.codes?.[binding.index];
  return code !== undefined && ABS_NAMES[code] ? `ABS_${ABS_NAMES[code]}` : `axis ${binding.index}`;
}

/**
 * Whether two bindings are the same physical pedal: the same input, moving
 * the same way. Two pedals on one combined axis — one pushes it up, the other
 * down — are different pedals, and stay allowed.
 */
export function samePedal(a, b) {
  if (!a || !b || a.pad !== b.pad || a.kind !== b.kind || a.index !== b.index) return false;
  if (a.kind !== 'axis') return true;
  return Math.sign(a.full - a.rest) === Math.sign(b.full - b.rest);
}

/**
 * One pedal, one job. A pedal bound to more than one of throttle, brake and
 * clutch keeps the first of them and the rest are unset — a pedal that is
 * both throttle and brake is a car that cannot do either.
 */
export function uniquePedals(mapping) {
  if (!mapping) return mapping;
  const out = { ...mapping };
  const seen = [];
  for (const key of PEDAL_KEYS) {
    const b = out[key];
    if (!b) continue;
    if (seen.some((s) => samePedal(s, b))) out[key] = null;
    else seen.push(b);
  }
  return out;
}

/**
 * Learns a mapping one movement at a time.
 *
 * Each step snapshots every connected device and then waits for one input to
 * move well clear of that snapshot. The step after waits for everything to
 * come back first — without that, letting go of the throttle registers as
 * pressing the brake, because the throttle axis is the one moving.
 *
 * The steering step also records where the wheel was when it started as its
 * centre, which is why the driver is asked to start with the wheel straight.
 *
 * Pedal steps are stricter, because pedals sit side by side under one pair
 * of feet and it is easy to press two:
 *
 *   - A round only counts once the pedal has been let back up, and it is
 *     watched for the whole press, not just the moment it was found. If any
 *     other pedal moves meaningfully at any point, the round is thrown out
 *     and asked for again.
 *   - A pedal already given a job in this calibration is refused for another.
 *   - Only axes count as pedals, except on a console pad, whose analogue
 *     triggers are buttons — a wheel button pressed by mistake is not a pedal.
 *
 * `notice` carries what the driver needs to hear about the last thing that
 * happened: a pedal found, or a round that has to be done again and why.
 */
export class MappingWizard {
  /**
   * @param {Array} pads   snapshot at the moment the wizard starts
   * @param {object} base  the mapping to start from; rotation and any skipped step keep its value
   * @param {Array<{key: string, prompt: string}>} [steps]  WIZARD_STEPS for a wheel, PEDAL_STEPS for pedals
   */
  constructor(pads, base, steps = WIZARD_STEPS) {
    this.steps = steps;
    this.result = { ...base };
    this.origin = snapshot(pads);
    this.step = 0;
    this.baseline = this.origin;
    this.listening = true;
    this.done = false;
    /** @type {{tone: 'ok'|'warn', text: string}|null} */
    this.notice = null;
    /** The pedal being pressed right now: found, but not counted until it is let go. */
    this._pending = null;
    this._pads = pads;
  }

  get current() { return this.steps[this.step] ?? null; }

  /** A pedal has been found and is being followed down; let go to count it. */
  get pressing() { return !!this._pending; }

  /** Every step answered and the last pedal let go, so its full travel is known. */
  get finished() { return this.done && !this._pending; }

  /** Moves on, keeping whatever this step was bound to before. */
  skip() {
    if (this.done) return;
    if (this._pending) {
      this.result[this._pending.key] = this._pending.before;
      this._pending = null;
    }
    this.notice = null;
    this._advance();
  }

  /**
   * @returns {string|null} the key just learned, if this snapshot completed a step
   */
  feed(pads) {
    this._pads = pads;
    const now = snapshot(pads);
    if (this._pending) this._follow(now);
    if (!this.listening) {
      if (!this._settled(now)) return null;
      const learned = this._settle();
      if (!this.done) {
        this.baseline = now;
        this.listening = true;
      }
      return learned;
    }
    if (this.done) return null;

    const key = this.current.key;
    if (PEDAL_KEYS.includes(key)) {
      this._findPedal(now, key);
      return null;
    }

    const found = key === 'steer' ? this._findAxis(now, STEER_MOVE, false)[0] ?? null : this._findButton(now);
    if (!found) return null;
    if (key === 'steer') {
      this.result.steer = { pad: found.pad, kind: 'axis', index: found.index,
                            centre: found.from, sign: found.delta > 0 ? 1 : -1 };
    } else {
      this.result[key] = { pad: found.pad, kind: 'button', index: found.index };
    }
    this._advance();
    return key;
  }

  _advance() {
    this.step++;
    this.listening = false;
    if (this.step >= this.steps.length) this.done = true;
  }

  /* ── pedals ───────────────────────────────────────────────────────── */

  _findPedal(now, key) {
    const moved = this._findAxis(now, PEDAL_MOVE, true);
    if (!moved.length) {
      const trigger = this._findTrigger(now);
      if (trigger) moved.push(trigger);
    }
    if (!moved.length) return;
    const found = moved[0];

    // Two pedals at the same moment: no way to know which was meant.
    if (moved.length > 1 || this._othersMoved(now, found)) {
      this._redo(`Two pedals moved at once, so that round did not count. Let go of both, then press only the ${LABEL[key]}.`);
      return;
    }

    const binding = found.kind === 'axis'
      ? { pad: found.pad, kind: 'axis', index: found.index, rest: found.from,
          full: found.from + found.delta * (1 - FULL_MARGIN), peak: found.from + found.delta }
      : { pad: found.pad, kind: 'button', index: found.index };

    // A pedal that already has a job in this calibration cannot take another.
    const earlier = this.steps.slice(0, this.step).find(({ key: k }) => samePedal(this.result[k], binding));
    if (earlier) {
      this._redo(`That pedal is already your ${LABEL[earlier.key]}. Let it go, then press the ${LABEL[key]}.`);
      return;
    }

    this._pending = { key, before: this.result[key] ?? null, crossed: false };
    this.result[key] = binding;
    this.listening = false;
    this.notice = { tone: 'ok', text: `Found the ${LABEL[key]} on ${inputLabel(binding, this._pads)} — now let it come all the way up.` };
  }

  /** Follows the pressed pedal down for its deepest point, and watches every other pedal while it does. */
  _follow(now) {
    const p = this._pending;
    const b = this.result[p.key];
    if (b.kind === 'axis') {
      const v = now.get(b.pad)?.axes[b.index];
      const dir = Math.sign(b.peak - b.rest);
      if (typeof v === 'number' && (v - b.peak) * dir > 0) {
        b.peak = v;
        b.full = b.rest + (v - b.rest) * (1 - FULL_MARGIN);
      }
    }
    if (this._othersMoved(now, b)) p.crossed = true;
  }

  /** Everything has been let go: count the round, or throw it out. */
  _settle() {
    const p = this._pending;
    if (!p) return null;
    this._pending = null;
    if (p.crossed) {
      this.result[p.key] = p.before;
      this.notice = { tone: 'warn', text: `Another pedal moved while you pressed the ${LABEL[p.key]}, so that round did not count. Press only the ${LABEL[p.key]}.` };
      return null;
    }
    this.notice = { tone: 'ok', text: `${LABEL[p.key][0].toUpperCase()}${LABEL[p.key].slice(1)} set on ${inputLabel(this.result[p.key], this._pads)}.` };
    this.step++;
    if (this.step >= this.steps.length) this.done = true;
    return p.key;
  }

  _redo(text) {
    this.notice = { tone: 'warn', text };
    this.listening = false;
  }

  /** Whether anything other than `binding` and the steering has moved a pedal's worth. */
  _othersMoved(now, binding) {
    for (const [id, cur] of now) {
      const was = this.baseline.get(id);
      if (!was) continue;
      for (let i = 0; i < cur.axes.length; i++) {
        if (this._isSteer(id, i)) continue;
        if (binding.kind === 'axis' && binding.pad === id && binding.index === i) continue;
        if (Math.abs(cur.axes[i] - (was.axes[i] ?? cur.axes[i])) > CROSSTALK) return true;
      }
      if (!cur.standard) continue;
      for (let i = 0; i < cur.buttons.length; i++) {
        if (binding.kind === 'button' && binding.pad === id && binding.index === i) continue;
        if (cur.buttons[i] - (was.buttons[i] ?? 0) > CROSSTALK) return true;
      }
    }
    return false;
  }

  /** An analogue trigger on a console pad pressed past half: that pad's only kind of pedal. */
  _findTrigger(now) {
    for (const [id, cur] of now) {
      const was = this.baseline.get(id);
      if (!was || !cur.standard) continue;
      for (let i = 0; i < cur.buttons.length; i++) {
        if (cur.buttons[i] >= 0.5 && !(was.buttons[i] >= 0.5)) return { pad: id, kind: 'button', index: i };
      }
    }
    return null;
  }

  /** The finished mapping, without the working notes kept while measuring, one pedal per job. */
  get mapping() {
    const out = { ...this.result };
    for (const key of PEDAL_KEYS) {
      if (out[key]?.peak !== undefined) {
        const { peak: _peak, ...binding } = out[key];
        out[key] = binding;
      }
    }
    return this.steps === PEDAL_STEPS ? uniquePedals(out) : out;
  }

  /* ── shared ───────────────────────────────────────────────────────── */

  _isSteer(pad, index) {
    const s = this.result.steer;
    return s && s.pad === pad && s.index === index;
  }

  /** Everything except the steering axis is back where it started. */
  _settled(now) {
    for (const [id, cur] of now) {
      const was = this.origin.get(id);
      if (!was) continue;
      for (let i = 0; i < cur.axes.length; i++) {
        if (this._isSteer(id, i)) continue;
        if (Math.abs(cur.axes[i] - (was.axes[i] ?? cur.axes[i])) > SETTLED) return false;
      }
      for (let i = 0; i < cur.buttons.length; i++) {
        if (cur.buttons[i] >= 0.5 && !(was.buttons[i] >= 0.5)) return false;
      }
    }
    return true;
  }

  /** Every axis that has moved at least `threshold` from the baseline, furthest first. */
  _findAxis(now, threshold, skipSteer) {
    const moved = [];
    for (const [id, cur] of now) {
      const was = this.baseline.get(id);
      if (!was) continue;
      for (let i = 0; i < cur.axes.length; i++) {
        if (skipSteer && this._isSteer(id, i)) continue;
        const from = was.axes[i];
        if (typeof from !== 'number') continue;
        const delta = cur.axes[i] - from;
        if (Math.abs(delta) >= threshold) moved.push({ pad: id, kind: 'axis', index: i, from, delta });
      }
    }
    return moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  /**
   * A button that is down now and was not at the baseline; analogue ones must
   * be half pressed. One already bound is passed over, so pulling the upshift
   * paddle again when asked for the downshift does not bind it twice.
   */
  _findButton(now) {
    const taken = (id, i) => this.steps.slice(0, this.step).some(({ key }) => {
      const b = this.result[key];
      return b?.kind === 'button' && b.pad === id && b.index === i;
    });
    for (const [id, cur] of now) {
      const was = this.baseline.get(id);
      if (!was) continue;
      for (let i = 0; i < cur.buttons.length; i++) {
        if (taken(id, i)) continue;
        if (cur.buttons[i] >= 0.5 && !(was.buttons[i] >= 0.5)) {
          return { pad: id, kind: 'button', index: i };
        }
      }
    }
    return null;
  }
}

/** Copies the values out — Gamepad objects can be live and change under us. */
function snapshot(pads) {
  const map = new Map();
  for (const p of pads) {
    if (!p) continue;
    map.set(p.id, { axes: [...p.axes], buttons: [...p.buttons].map(buttonValue), standard: p.mapping === 'standard' });
  }
  return map;
}

/* ── remembering ────────────────────────────────────────────────────── */

const PEDAL_STORE_KEY = 'wheelhouse.pedals';

function loadStore(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object') {
      return { last: raw.last ?? null, maps: { ...(raw.maps ?? {}) } };
    }
  } catch { /* nothing stored, or storage is unavailable */ }
  return { last: null, maps: {} };
}

function saveStore(key, store) {
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch { /* private window, or storage is full — the mapping just will not stick */ }
}

/** Same shape as `loadWheels`: the pedal device chosen last, and a mapping per device. */
export const loadPedals = () => loadStore(PEDAL_STORE_KEY);
export const savePedals = (store) => saveStore(PEDAL_STORE_KEY, store);

/**
 * @returns {{last: string|null, maps: Record<string, object>}}
 *   `last` is the device the driver chose most recently; `maps` holds a
 *   mapping per wheel, so swapping between two wheels keeps both.
 */
export const loadWheels = () => loadStore(STORE_KEY);
export const saveWheels = (store) => saveStore(STORE_KEY, store);

/**
 * Picks the device to steer with.
 *
 * The one chosen last wins if it is plugged in. Otherwise the first thing
 * that looks like a wheel — but never a plain pad on its own initiative: a
 * wheel source outranks the camera, so a controller left on the desk would
 * otherwise take the steering away from the driver's hands. A pad still
 * steers if the driver picks it.
 */
export function chooseDevice(pads, last) {
  const ids = pads.filter(Boolean).map((p) => p.id);
  if (last && ids.includes(last)) return last;
  return ids.find((id) => isLikelyWheel(id)) ?? null;
}

/* ── the other direction: the rig turning the rim ───────────────────── */

/**
 * The raw axis value (−1…1) at which the rim reads `degrees`. The inverse of
 * `steerDegrees`, used to aim the force-feedback spring.
 */
export function steerToAxis(mapping, degrees) {
  const b = mapping?.steer;
  if (!b || b.kind !== 'axis' || !mapping.rotation) return null;
  return clamp((b.centre ?? 0) + (b.sign ?? 1) * degrees / (mapping.rotation / 2), -1, 1);
}

/**
 * Works out whether a person is turning the rim.
 *
 * A wheel that can be driven is also a wheel that can be grabbed, and the two
 * must never fight: when the driver turns it, the rig has to stop pulling and
 * follow. With nothing driving it, any real movement is a person. While it is
 * being driven, the rim trails its target a little as the motor catches up,
 * so only a gap well beyond that — held for a moment, not a single frame —
 * counts as a hand on it. A fast-moving target opens the allowance, since the
 * spring lags further behind it.
 *
 * A person keeps the lead until the rim has been left alone for `holdMs`.
 */
export class LeadTracker {
  constructor({ moveDeg = 1.5, grabDeg = 10, grabMs = 120, holdMs = 1200, lagSeconds = 0.1 } = {}) {
    Object.assign(this, { moveDeg, grabDeg, grabMs, holdMs, lagSeconds });
    this.reset();
  }

  reset() {
    this.anchor = null;
    this.userAt = -Infinity;
    this._apartSince = null;
    this._lastTarget = null;
    this._lastAt = null;
  }

  /**
   * @param {number} measured  where the rim is, degrees
   * @param {number|null} target  where the rig is driving it, or null if it is not
   * @param {number} now  ms
   * @returns {boolean} whether a person is steering with the rim
   */
  update(measured, target, now) {
    if (target === null) {
      this._apartSince = null;
      this._lastTarget = null;
      if (this.anchor === null) this.anchor = measured;
      if (Math.abs(measured - this.anchor) > this.moveDeg) {
        this.userAt = now;
        this.anchor = measured;
      }
    } else {
      const dt = this._lastAt === null ? 0 : (now - this._lastAt) / 1000;
      const speed = this._lastTarget === null || dt <= 0 ? 0 : Math.abs(target - this._lastTarget) / dt;
      this._lastTarget = target;
      const allowance = this.grabDeg + speed * this.lagSeconds;
      if (Math.abs(measured - target) > allowance) {
        this._apartSince ??= now;
        if (now - this._apartSince >= this.grabMs) this.userAt = now;
      } else {
        this._apartSince = null;
      }
      this.anchor = measured;
    }
    this._lastAt = now;
    return this.leading(now);
  }

  leading(now) { return now - this.userAt < this.holdMs; }
}

/**
 * How far the rig turns each way, in degrees, with this wheel connected.
 *
 * A wheel set to 540° lock to lock turns 270° each way and no further, so the
 * rig must stop there too — otherwise it could be steered, by a drag or the
 * keys, somewhere the rim cannot follow, and the two would disagree for good.
 * Never past the rig's own limit, and with no wheel the rig's limit is all
 * there is.
 *
 * @param {number} rigMax  the rig's own lock each way (LOCK_DEGREES)
 * @param {number|null|undefined} rotation  the wheel's lock-to-lock range, if one is connected
 */
export function lockFor(rigMax, rotation) {
  return rotation > 0 ? Math.min(rigMax, rotation / 2) : rigMax;
}

/**
 * Measuring a wheel's rotation.
 *
 * A wheel reports where it is as a fraction of its own travel — at full lock
 * it reads 1 whether it is set to 270° or 1080° — so the degrees behind that
 * fraction cannot be read from the axis. Moza bases say over their serial
 * port, when nothing else holds it; everything else needs a reference the
 * driver can see. Half a turn is the clearest one there is: the rim upside
 * down. How far the axis moved for those 180° gives the whole range.
 *
 * A wheel set to 360° or less cannot get to half a turn before its lock, so
 * if the rim comes to rest at the lock the measurement asks for a quarter
 * turn instead — the rim vertical.
 */
export class RotationMeasurement {
  constructor({ now, stillMs = 1500, timeoutMs = 45000 }) {
    Object.assign(this, { stillMs, timeoutMs });
    this.startedAt = now;
    this.phase = 'centre';
    this.centre = null;
    this.result = null;
    this._ref = null;
    this._since = now;
    this._leftLock = true;
  }

  get active() { return this.phase === 'centre' || this.phase === 'half' || this.phase === 'quarter'; }

  /** @returns {'centre'|'half'|'quarter'|'done'|'failed'} */
  update(raw, now) {
    if (!this.active || typeof raw !== 'number') return this.phase;
    // Still means within about a degree on a typical wheel, for long enough
    // to mean it — a pause on the way round is not the answer.
    if (this._ref === null || Math.abs(raw - this._ref) > 0.004) {
      this._ref = raw;
      this._since = now;
    }
    const still = now - this._since >= this.stillMs;
    const atLock = Math.abs(raw) >= 0.985;
    const turned = this.centre === null ? 0 : Math.abs(raw - this.centre);

    if (now - this.startedAt > this.timeoutMs) {
      this.phase = 'failed';
    } else if (this.phase === 'centre') {
      if (still && !atLock) {
        this.centre = raw;
        this.phase = 'half';
        this._ref = null;
      }
    } else if (this.phase === 'half') {
      if (still && atLock) {
        // Stopped at the lock: it will not go half a turn.
        this.phase = 'quarter';
        this._leftLock = false;
        this._ref = null;
      } else if (still && turned >= 0.1) {
        this._finish(180, turned);
      }
    } else if (this.phase === 'quarter') {
      if (!atLock) this._leftLock = true;
      if (still && this._leftLock && !atLock && turned >= 0.1) this._finish(90, turned);
    }
    return this.phase;
  }

  _finish(degrees, turned) {
    // Lock to lock is the whole axis, −1 to 1, so it is 2 / turned of the turn.
    const rotation = Math.round((2 * degrees) / turned / 10) * 10;
    if (rotation < 90 || rotation > 2700) {
      this.phase = 'failed';
      return;
    }
    this.result = rotation;
    this.phase = 'done';
  }

  get message() {
    switch (this.phase) {
      case 'centre': return 'Measuring rotation — hold the rim straight ahead and keep it still…';
      case 'half': return 'Now turn it half a turn to the right, until the rim is upside down, and hold it there…';
      case 'quarter': return 'Your wheel stops before half a turn. Turn it back to a quarter turn — the rim vertical — and hold it there…';
      case 'done': return `Your wheel turns ${this.result}° lock to lock — ±${this.result / 2}° each way.`;
      default: return 'Could not measure the rotation — the rim never held still where it was asked. Nothing was changed.';
    }
  }
}

/**
 * Calibration by sweep: to the middle, full lock one way, full lock the
 * other, back to the middle. Starting from the middle means every sweep
 * begins the same way, from straight ahead, wherever the rim was left.
 *
 * On a wheel the rig can turn, the motor does the sweep; otherwise the driver
 * does, asked one step at a time. Each end is taken where the rim actually
 * came to rest — against its stop, or the base's soft limit — and the middle
 * where it settled when driven back to the base's own centre. Together they
 * are the wheel's exact travel either side of straight ahead, and they can
 * differ: a centre a few degrees off leaves more lock one way than the other.
 *
 * What a sweep cannot give is degrees. The axis reports where the rim is as
 * a fraction of its travel, so both ends read ±1 at any rotation; the degrees
 * between them come from the base (a Moza says, when its serial port is
 * free), a measurement, or the driver.
 *
 * Fed raw axis values (−1…1) and a clock, so it runs in Node.
 */
export class SweepCalibration {
  /**
   * @param {object} o
   * @param {boolean} o.drivable  whether the rig can turn this rim
   * @param {number} o.now  ms
   * @param {number} [o.sign]  which way the axis runs: +1 when clockwise reads positive
   */
  constructor({ drivable, now, sign = 1, ffSign = 1, stillMs = drivable ? 250 : 900, timeoutMs = drivable ? 9000 : 30000 }) {
    Object.assign(this, { drivable, sign, stillMs, timeoutMs });
    /**
     * Which way the motor's spring runs against the axis. Force-feedback
     * drivers do not agree: on some, aiming the spring at −1 sends the rim
     * to +1. The sweep finds out — the first lock it is sent to, it either
     * gets there or ends up at the other one — and corrects it.
     */
    this.ffSign = ffSign;
    /** Set on the frame the sweep finds the spring running backwards. */
    this.flipped = false;
    this.phase = 'start';
    this.left = null;
    this.right = null;
    this.centre = null;
    this._phaseAt = now;
    this._ref = null;
    this._since = now;
  }

  get active() { return ['start', 'left', 'right', 'centre'].includes(this.phase); }

  /**
   * Where the motor should be aiming the rim, in raw axis units: the base's
   * centre, each lock, then the centre again. Anticlockwise is the driver's
   * left.
   */
  get aim() {
    return this.phase === 'left' ? -this.sign : this.phase === 'right' ? this.sign : 0;
  }

  /**
   * @param {number} raw  the rim's axis now
   * @param {number} now  ms
   * @param {boolean} [arrived]  the motor's aim has reached this phase's target
   * @returns {'start'|'left'|'right'|'centre'|'done'|'failed'}
   */
  update(raw, now, arrived = true) {
    if (!this.active || typeof raw !== 'number') return this.phase;
    if (this._ref === null || Math.abs(raw - this._ref) > 0.002) {
      this._ref = raw;
      this._since = now;
    }
    const still = now - this._since >= this.stillMs;

    if (now - this._phaseAt > this.timeoutMs) {
      this.phase = 'failed';
    } else if (this.phase === 'start') {
      // Straight ahead first, settled, before setting off for the locks.
      if (arrived && still && Math.abs(raw) <= (this.drivable ? 0.05 : 0.25)) this._next('left', now);
    } else if (this.phase === 'left' || this.phase === 'right') {
      // An end is where the rim stopped, well over to that side: the motor
      // has done all it can, or the driver has hit the stop.
      const side = this.phase === 'left' ? -this.sign : this.sign;
      if (arrived && still && raw * side > 0.5) {
        this[this.phase] = raw;
        this._next(this.phase === 'left' ? 'right' : 'centre', now);
      } else if (this.drivable && arrived && still && raw * side < -0.5 && this.phase === 'left' && this.left === null) {
        // Sent one way, it went the other: the spring runs backwards on this
        // wheel. Turn it round and send it again.
        this.ffSign = -this.ffSign;
        this.flipped = true;
        this._next('left', now);
      }
    } else if (this.phase === 'centre') {
      // Back near the middle and settled. Driven by the motor, 0 is the
      // base's own centre whatever friction left the rim a hair short of it;
      // turned by hand, it is wherever the driver holds straight ahead.
      const nearMiddle = Math.abs(raw) <= (this.drivable ? 0.05 : 0.25);
      if (arrived && still && nearMiddle) {
        this.centre = this.drivable ? 0 : raw;
        this.phase = 'done';
      }
    }
    return this.phase;
  }

  _next(phase, now) {
    this.phase = phase;
    this._phaseAt = now;
    this._ref = null;
  }

  /** Degrees either side of the new centre, given the wheel's rotation. */
  range(rotation) {
    if (this.phase !== 'done') return null;
    const half = rotation / 2;
    return {
      min: (this.left - this.centre) * this.sign * half,
      max: (this.right - this.centre) * this.sign * half,
    };
  }

  get message() {
    const hands = this.drivable ? 'Hands off the rim — ' : '';
    switch (this.phase) {
      case 'start': return this.drivable
        ? `${hands}bringing it to the centre first…`
        : 'Hold the rim straight ahead and keep it still…';
      case 'left': return this.drivable
        ? `${hands}turning it to full anticlockwise lock…`
        : 'Turn the rim all the way anticlockwise, to its stop, and hold it there…';
      case 'right': return this.drivable
        ? `${hands}now to full clockwise lock…`
        : 'Now all the way clockwise, to its stop, and hold it…';
      case 'centre': return this.drivable
        ? `${hands}and back to the centre…`
        : 'And back to straight ahead — hold it still…';
      case 'done': return 'Calibrated.';
      default: return this.drivable
        ? 'Calibration stopped — the rim did not get where it was sent. Is something holding it? Nothing was changed.'
        : 'Calibration stopped — the rim never held still where it was asked. Nothing was changed.';
    }
  }
}

/**
 * How far the rig may turn each way with this wheel, in degrees: the wheel's
 * own ends when a calibration has found them — which need not be equal — or
 * half its rotation each way, and never past the rig's own limit.
 *
 * @param {number} rigMax  the rig's own lock each way (LOCK_DEGREES)
 * @param {object|null} mapping  the wheel's mapping, or null with no wheel
 * @returns {{min: number, max: number}}
 */
export function lockRange(rigMax, mapping) {
  if (!mapping?.rotation) return { min: -rigMax, max: rigMax };
  const half = mapping.rotation / 2;
  const ends = mapping.ends;
  const s = mapping.steer;
  if (ends && s?.kind === 'axis') {
    const at = (raw) => (raw - (s.centre ?? 0)) * (s.sign ?? 1) * half;
    const a = at(ends.left), b = at(ends.right);
    return { min: Math.max(-rigMax, Math.min(a, b)), max: Math.min(rigMax, Math.max(a, b)) };
  }
  const each = Math.min(rigMax, half);
  return { min: -each, max: each };
}

/**
 * A smooth path to a moving target, for anything the motor drives.
 *
 * Sending the motor's spring straight to a target, or along at a constant
 * speed, starts and stops it instantly — infinite acceleration — which the
 * rim delivers as a jolt at every change: each end of a calibration sweep,
 * every reversal of the rig. This speeds up at a limited rate, cruises at a
 * limited speed, and brakes at the same rate so that it arrives exactly on
 * the target and stops, never overshooting. A target that moves is simply
 * chased the same way.
 */
export class MotionProfile {
  /**
   * @param {object} o
   * @param {number} o.maxSpeed  units per second
   * @param {number} o.maxAccel  units per second²
   */
  constructor({ maxSpeed, maxAccel, position = 0 }) {
    this.maxSpeed = maxSpeed;
    this.maxAccel = maxAccel;
    this.reset(position);
  }

  /** Start from here, at rest. */
  reset(position) {
    this.position = position;
    this.velocity = 0;
  }

  /** Where it has got to on the way to `target` after `dt` seconds. */
  step(target, dt) {
    if (!(dt > 0)) return this.position;
    const gap = target - this.position;
    // The fastest it may be going and still stop on the target, allowing
    // for moving one more step at that speed before braking — without that
    // it arrives a little too fast and the last frame is a jolt.
    const a = this.maxAccel;
    const canStopFrom = a * (-dt + Math.sqrt(dt * dt + (2 * Math.abs(gap)) / a));
    const wanted = Math.sign(gap) * Math.min(this.maxSpeed, canStopFrom);
    const change = this.maxAccel * dt;
    this.velocity += Math.max(-change, Math.min(change, wanted - this.velocity));
    let next = this.position + this.velocity * dt;
    // Arrived, or about to pass it: stop on it.
    if ((target - next) * Math.sign(gap) <= 0 || (Math.abs(target - next) < 1e-6 && Math.abs(this.velocity) <= change)) {
      next = target;
      this.velocity = 0;
    }
    this.position = next;
    return next;
  }
}
