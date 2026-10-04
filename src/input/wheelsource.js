/**
 * A real steering wheel — or any game controller — plugged into the machine.
 *
 * Read through the Gamepad API, which needs no driver, no permission prompt
 * and nothing from the main process: if the operating system sees the wheel
 * as a game controller, so does this. Hot-plugging works both ways.
 *
 * One catch decides how the panel words things. Browsers keep controllers
 * hidden from a page until one is touched after the page loads — a privacy
 * rule, so sites cannot fingerprint what is plugged in — so a wheel that is
 * connected but has not been moved looks exactly like no wheel at all. The
 * status says so rather than leaving the driver to wonder.
 *
 * Inside the desktop shell on Linux it reads through the hardware helper
 * instead (`NativeWheels`), which sees a wheel the moment it is plugged in
 * and can also turn it. Then the link runs both ways:
 *
 *   - turn the rim and the rig's wheel turns with it;
 *   - steer the rig any other way — drag it, the keys, your hands on camera —
 *     and the rim is driven to match, through a force-feedback spring.
 *
 * The two must never fight, so who leads is decided every frame. The rim
 * sits at the bottom of the priority order, below every other input, so
 * anything else that is steering wins and the rim follows it. The moment a
 * person turns the rim, `LeadTracker` notices and the rim jumps to the top
 * and lets go of its spring — it follows the hand on it, not the other way
 * round — until it has been left alone for a moment.
 */
import { SteeringSource } from './source.js';
import {
  chooseDevice, defaultMapping, displayName, isLikelyWheel, loadWheels, saveWheels,
  steerDegrees, steerToAxis, buttonPressed, MappingWizard, LeadTracker, WIZARD_STEPS,
  SweepCalibration, RotationMeasurement, MotionProfile,
} from './wheels.js';
import { OneEuroFilter } from '../vision/handmath.js';

const DEG = Math.PI / 180;

/** Priority while a person is turning the rim, and while they are not. */
const LEAD_PRIORITY = 30;
const FOLLOW_PRIORITY = 2;

/**
 * The fastest the rig will swing the rim, in degrees per second. A target can
 * jump — a hand reacquired at 90°, a reset to centre — and a motor told to
 * jump does exactly that, into whatever is in its way.
 */
const MAX_SLEW = 540;

/**
 * How fast the motor sweeps the rim while calibrating, in axis units per
 * second: lock to lock in about four seconds on any rotation — brisk, but
 * slow enough to stop against a hand without a jolt.
 */
const SWEEP_SPEED = 0.5;
/**
 * And how hard it speeds up and slows down doing it, axis units per second²:
 * full sweep speed in about 0.4 s, eased in and out of every stop.
 */
const SWEEP_ACCEL = 1.2;
/**
 * How hard the rim may be swung when it follows the rig, degrees per second²:
 * enough to keep up with a quick hand on the mouse, never a snap.
 */
const FOLLOW_ACCEL = 2400;

/** How long the neutral button is held to select reverse instead, ms. */
export const HOLD_FOR_REVERSE = 600;

export class WheelSource extends SteeringSource {
  /**
   * @param {object} o
   * @param {number} [o.priority]
   * @param {(direction: -1|1) => void} [o.onShift]  a paddle was pulled
   * @param {(event: {type: string, name: string}) => void} [o.onDevice]  connected / disconnected
   * @param {() => Array} [o.getPads]  stands in for navigator.getGamepads in tests
   * @param {import('./nativewheels.js').NativeWheels} [o.native]  the hardware helper, when there is one
   * @param {() => void} [o.onCentred]  the rim has a new 0°; the rig should centre to match
   * @param {(gear: 'neutral'|'reverse') => void} [o.onGear]  a gear button
   */
  constructor({ priority = FOLLOW_PRIORITY, onShift, onDevice, getPads, native = null, now, onCentred, onGear } = {}) {
    super('wheel', priority);
    this.onShift = onShift ?? (() => {});
    this.onDevice = onDevice ?? (() => {});
    this.onCentred = onCentred ?? (() => {});
    this.onGear = onGear ?? (() => {});
    /** When the neutral button went down, for telling a press from a hold. */
    this._neutralSince = null;
    /** A centre calibration in progress, or null. */
    this.centring = null;
    /** How the last one ended, for the panel: `{ok, text, at}`. */
    this.centreResult = null;
    /**
     * The rim on its way back to 0° under the motor — the Centre button —
     * or null. Unlike a calibration it changes nothing: it only puts the rim
     * back where straight ahead already is.
     */
    this.returning = null;
    /** A rotation measurement in progress, or null, and how the last one ended. */
    this.measuring = null;
    this.measureResult = null;
    /**
     * Calibration waiting on the base to say how far it turns — the port
     * held by Boxflat — or null. The sweep starts the moment it can.
     */
    this.awaitingBase = null;
    /** A measurement started by Calibrate, to be followed by the sweep. */
    this._sweepAfterMeasure = false;
    this._centreAim = 0;
    /** The smooth path the motor's aim takes while calibrating or centring. */
    this._sweep = new MotionProfile({ maxSpeed: SWEEP_SPEED, maxAccel: SWEEP_ACCEL });
    /** And while the rim follows the rig. */
    this._follow = new MotionProfile({ maxSpeed: MAX_SLEW, maxAccel: FOLLOW_ACCEL });
    /**
     * The rig follows the rim through this: steady when still, opening up at
     * once for a fast turn, so the on-screen wheel shows the rim's motion and
     * not the jitter in when its readings arrive.
     */
    this._smooth = new OneEuroFilter({ minCutoff: 6, beta: 0.6 });
    this.native = native;
    this.getPads = getPads ?? (native
      ? () => native.pads
      : () => [...(navigator.getGamepads?.() ?? [])]);
    this.now = now ?? (() => performance.now());

    /** Force feedback: whether the rig may turn the rim, and how hard. */
    this.force = { enabled: true, strength: 0.3 };
    this.lead = new LeadTracker();
    /** A person is turning the rim right now. */
    this.leading = false;
    /** Where the rim is being driven to, in degrees, or null if it is not. */
    this.driving = null;
    this._lastPoll = null;

    this.store = loadWheels();
    /** Every controller the browser is currently showing us. */
    this.pads = [];
    /** The id of the one steering, or null. */
    this.deviceId = null;
    this.mapping = null;
    this.wizard = null;

    /** Where the rim is, in degrees. Pedals are a separate device: `PedalSet`. */
    this.degrees = 0;

    this._held = { up: false, down: false, neutral: false, reverse: false };
    this._onConnect = () => this.poll();
    this._onDisconnect = () => this.poll();
  }

  async connect() {
    window.addEventListener('gamepadconnected', this._onConnect);
    window.addEventListener('gamepaddisconnected', this._onDisconnect);
  }

  disconnect() {
    window.removeEventListener('gamepadconnected', this._onConnect);
    window.removeEventListener('gamepaddisconnected', this._onDisconnect);
  }

  /**
   * Dynamic, and re-read by the controller every frame: bottom of the order
   * so anything else steering wins and the rim follows it, top of it while a
   * person is turning the rim.
   */
  get priority() { return this.leading ? LEAD_PRIORITY : this._priority; }
  set priority(value) { this._priority = value; }

  get connected() { return this.deviceId !== null; }

  /**
   * The rim's lock-to-lock range while it is connected and in use, or null —
   * the rig stops wherever the rim does.
   */
  get rotation() {
    return this.connected && this.enabled && this.mapping ? this.mapping.rotation : null;
  }

  /** Whether the rig can turn this rim. */
  get drivable() {
    const pad = this.mapping?.steer?.pad;
    return !!(this.native && pad && this.native.canDrive(pad) && this.mapping.steer.kind === 'axis');
  }

  /** For the panel: what the link between the two wheels is doing. */
  get mode() {
    if (!this.connected) return 'none';
    if (!this.enabled) return 'off';
    if (this.wizard) return 'mapping';
    if (this.centring || this.awaitingBase) return 'centring';
    if (this.returning) return 'returning';
    if (this.measuring) return 'measuring';
    if (this.driving !== null) return 'following';
    return 'leading';
  }
  get deviceName() { return this.deviceId ? displayName(this.deviceId) : null; }

  /** What the settings picker lists. */
  get devices() {
    return this.pads.map((p) => ({ id: p.id, name: displayName(p.id), wheel: isLikelyWheel(p.id) }));
  }

  /**
   * Reads the hardware. Call once per frame, before the controller updates —
   * the Gamepad API is polled, not evented, apart from connect and disconnect.
   */
  poll() {
    let pads;
    try { pads = this.getPads().filter(Boolean); } catch { pads = []; }
    this.pads = pads;

    const id = chooseDevice(pads, this.store.last);
    if (id !== this.deviceId) this._switchTo(id);

    // Whether this poll began mid-mapping. The last paddle pulled for the
    // wizard is still held on the poll that finishes it, and must not then
    // be read as a gear change.
    const mapping = !!this.wizard;
    if (this.wizard) {
      this.wizard.feed(pads);
      if (this.wizard.finished) this._finishWizard();
    }

    if (!this.mapping) return;

    this.degrees = steerDegrees(this.mapping, pads) ?? 0;
    const now = this.now();
    // Take what the base says first, so a calibration waiting on it can go
    // on in the same frame.
    this._adoptBaseRotation();
    if (this.awaitingBase && this.rotationKnown) {
      // The base has said — Boxflat closed, the port read. On with the sweep.
      this.awaitingBase = null;
      this.calibrateCentre();
    } else if (this.awaitingBase && now - this.awaitingBase.at > 5000) {
      // The base has not answered. Do not wait on it: measure instead.
      this.awaitingBase = null;
      this._sweepAfterMeasure = true;
      this.measureRotation();
      this.measureResult = null;
    }
    if (this.centring) this._advanceCentring(pads, now);
    if (this.returning) this._advanceReturn(pads, now);
    if (this.measuring) this._advanceMeasuring(pads, now);
    // Nobody is steering with the rim while it is being centred: the motor is.
    this.leading = this.enabled && !this.wizard && !this.centring && !this.measuring && !this.returning
      && this.lead.update(this.degrees, this.driving, now);
    this._lastPoll = now;

    // Paddles fire once per pull, on the press. Not while mapping, where
    // pulling one is the answer to a question rather than a gear change.
    for (const [key, direction] of [['up', 1], ['down', -1]]) {
      const down = buttonPressed(this.mapping[key], pads);
      if (down && !this._held[key] && this.enabled && !mapping) this.onShift(direction);
      this._held[key] = down;
    }

    // Gear buttons, as on an F1 wheel: neutral on a press, reverse on a
    // hold of the same button — or on a reverse button of its own.
    const live = this.enabled && !mapping;
    const nDown = buttonPressed(this.mapping.neutral, pads);
    if (nDown && !this._held.neutral) this._neutralSince = now;
    if (nDown && this._neutralSince !== null && now - this._neutralSince >= HOLD_FOR_REVERSE) {
      if (live) this.onGear('reverse');
      this._neutralSince = null;            // a hold fires once
    }
    if (!nDown && this._held.neutral && this._neutralSince !== null && live) this.onGear('neutral');
    if (!nDown) this._neutralSince = null;
    this._held.neutral = nDown;
    const rDown = buttonPressed(this.mapping.reverse, pads);
    if (rDown && !this._held.reverse && live) this.onGear('reverse');
    this._held.reverse = rDown;
  }

  /**
   * Drives the rim toward `degrees`, or lets it go with null. Call once per
   * frame after the controller has updated, with its angle when something
   * other than this wheel is steering.
   */
  drive(degrees, dt = 1 / 60) {
    // Centre takes the motor over: back to 0°, whatever the rig is asking for.
    if (this.returning) {
      const target = this.mapping.steer.centre ?? 0;
      this._centreAim = this._sweep.step(target, Math.max(dt, 0));
      const strength = Math.min(0.5, Math.max(0.2, this.force.strength));
      this.native.follow(this.mapping.steer.pad, this._centreAim * (this.mapping.ffSign ?? 1), strength);
      this.driving = null;
      return;
    }
    // Calibrating takes the motor over: it sweeps the rim to each lock and
    // back to the base's centre, whatever the rig is asking for.
    if (this.centring?.active && this.centring.drivable) {
      this._centreAim = this._sweep.step(this.centring.aim, Math.max(dt, 0));
      // Firm enough to get there against friction, gentle enough to be a
      // surprise nobody minds.
      const strength = Math.min(0.5, Math.max(0.2, this.force.strength));
      this.native.follow(this.mapping.steer.pad, this._centreAim * this.centring.ffSign, strength);
      this.driving = null;
      return;
    }
    const allowed = degrees !== null && this.enabled && this.force.enabled
      && !this.leading && !this.wizard && this.drivable && this.force.strength > 0;
    if (!allowed) {
      if (this.driving !== null) this.native?.release();
      this.driving = null;
      return;
    }
    // Start from where the rim is, at rest, not from wherever it was last
    // driven, so taking over does not begin with a lurch — and then chase the
    // rig smoothly, speeding up and slowing down rather than snapping.
    if (this.driving === null) this._follow.reset(this.degrees);
    this.driving = this._follow.step(degrees, Math.max(dt, 0));
    const centre = steerToAxis(this.mapping, this.driving);
    if (centre !== null) this.native.follow(this.mapping.steer.pad, centre * (this.mapping.ffSign ?? 1), this.force.strength);
  }

  read() {
    if (!this.enabled || !this.mapping || this.wizard || this.measuring) return null;
    // Placed rather than sprung to. The rim is a physical object with its own
    // inertia already; putting the controller's spring on top of it would only
    // add the lag the spring exists to hide on a camera.
    const angle = this._smooth.filter(this.degrees * DEG, this.now() / 1000);
    return { angle, confidence: 1, snap: true };
  }

  /** Steers with a particular controller, remembered across restarts. */
  select(id) {
    this.store.last = id;
    saveWheels(this.store);
    this.poll();
  }

  /**
   * Wheel's lock-to-lock range. On a Moza base whose serial port is free it
   * is written to the base itself, as Boxflat does; on anything else it has
   * to match what the wheel's own software is set to.
   */
  setRotation(degrees, from = 'set') {
    if (!this.mapping || !(degrees >= 90 && degrees <= 2700)) return;
    if (this.baseConnected && from !== 'base') this.native.mozaWrite('rotation', degrees);
    this.mapping = { ...this.mapping, rotation: Math.round(degrees), rotationFrom: from };
    this._save();
  }

  /**
   * Whether the rotation is the wheel's real one — read from the base,
   * measured or typed in — rather than a default that may be far off. A
   * wheel set to 420° read as 900° turns the rig more than twice as far as
   * the rim, and stops it in the wrong place.
   */
  get rotationKnown() {
    return !!this.mapping && this.mapping.rotationFrom !== undefined && this.mapping.rotationFrom !== 'default';
  }

  /** Works out the rotation from a turn the driver can see: see `RotationMeasurement`. */
  measureRotation() {
    if (!this.connected || this.mapping?.steer?.kind !== 'axis') return null;
    this.wizard = null;
    if (this.centring) this.cancelCentre();
    this.drive(null);
    this.measureResult = null;
    this.measuring = new RotationMeasurement({ now: this.now() });
    // Measured by hand: the motor must not be holding the rim anywhere.
    this.native?.release();
    return this.measuring;
  }

  cancelMeasure() {
    if (!this.measuring) return;
    this.measuring = null;
    this._sweepAfterMeasure = false;
    this.measureResult = { ok: false, text: 'Measuring cancelled. Nothing was changed.', at: this.now() };
  }

  _advanceMeasuring(pads, now) {
    const phase = this.measuring.update(this._rawSteer(pads), now);
    if (phase === 'done') {
      this.setRotation(this.measuring.result, 'measured');
      this.measureResult = { ok: true, text: this.measuring.message, at: now };
      this.measuring = null;
      this.lead.reset();
      if (this._sweepAfterMeasure) {
        this._sweepAfterMeasure = false;
        this.calibrateCentre();
      }
    } else if (phase === 'failed') {
      this.measureResult = { ok: false, text: this.measuring.message, at: now };
      this.measuring = null;
      this._sweepAfterMeasure = false;
    }
  }

  /** A Moza base is on the serial port and answering. */
  get baseConnected() {
    return this.native?.moza.state === 'ok' && /Vendor: 346e/i.test(this.deviceId ?? '');
  }

  /**
   * The base knows its own rotation, so when it says, that is the answer —
   * whether the app holds its port or asked alongside Boxflat.
   */
  _adoptBaseRotation() {
    if (!this.isMoza || !this.native) return;
    const rotation = this.native.moza.values?.rotation;
    if (rotation > 0 && (rotation !== this.mapping.rotation || this.mapping.rotationFrom !== 'base')) {
      this.mapping = { ...this.mapping, rotation, rotationFrom: 'base' };
      this._save();
    }
  }

  /** Forgets this wheel's learned controls and goes back to the defaults. */
  resetMapping() {
    const pad = this.pads.find((p) => p.id === this.deviceId);
    if (!pad) return;
    this.mapping = defaultMapping(pad);
    this._save();
  }

  /**
   * Finds straight ahead: drives the rim to its centre — or, on a wheel the
   * rig cannot turn, waits for the driver to hold it there — and makes that
   * the rig's 0°.
   */
  /**
   * Calibrates by sweep — full lock anticlockwise, full lock clockwise, back
   * to the middle — and takes the ends and the centre from where the rim
   * actually came to rest. See `SweepCalibration`.
   */
  calibrateCentre() {
    if (!this.connected || !this.mapping || this.mapping.steer?.kind !== 'axis') return null;
    if (this.returning) this.cancelReturn();
    this.wizard = null;
    this.centreResult = null;
    // A sweep finds the ends but not the degrees between them, and without
    // the degrees every number it produced would be the guess's. So the
    // rotation comes first: from the base itself when it is a Moza that can
    // be asked, otherwise measured from a half turn.
    if (!this.rotationKnown) {
      if (this.isMoza && this.native && this.native.moza.state !== 'absent') {
        // Ask it — over its own port, or alongside Boxflat if Boxflat has it.
        this.native.mozaRead(['rotation', 'max-angle']);
        this.awaitingBase = { at: this.now() };
        return null;
      }
      this._sweepAfterMeasure = true;
      return this.measureRotation();
    }
    this.measuring = null;
    this.drive(null);
    const raw = this._rawSteer(this.pads);
    this._centreAim = raw ?? 0;
    this._sweep.reset(this._centreAim);
    this.centreResult = null;
    this.centring = new SweepCalibration({
      drivable: this.drivable, now: this.now(), sign: this.mapping.steer.sign ?? 1,
      ffSign: this.mapping.ffSign ?? 1,
    });
    return this.centring;
  }

  /**
   * The Centre button: puts the rim back at 0° — driven there by the motor
   * where it can be, or, on a wheel it cannot turn, taken as 0° wherever the
   * driver is holding it — and has the rig centre with it.
   */
  centre() {
    if (!this.connected || this.mapping?.steer?.kind !== 'axis') return false;
    if (this.centring || this.measuring || this.awaitingBase || this.wizard) return false;
    const raw = this._rawSteer(this.pads);
    if (!this.drivable) {
      if (raw === null) return false;
      this.mapping = { ...this.mapping, steer: { ...this.mapping.steer, centre: raw } };
      this._save();
      this.degrees = 0;
      this.centreResult = { ok: true, text: 'Centred: this is now straight ahead.', at: this.now() };
      this.onCentred();
      return true;
    }
    this.drive(null);
    this._centreAim = raw ?? 0;
    this._sweep.reset(this._centreAim);
    this.centreResult = null;
    this.returning = { at: this.now(), stillSince: null, ref: null };
    return true;
  }

  _advanceReturn(pads, now) {
    const r = this.returning;
    const raw = this._rawSteer(pads);
    const target = this.mapping.steer.centre ?? 0;
    const arrived = Math.abs(this._centreAim - target) < 1e-6;
    // Within a degree of straight and settled: that is centred.
    const tol = 1 / (this.mapping.rotation / 2);
    if (r.ref === null || Math.abs(raw - r.ref) > 0.002) { r.ref = raw; r.stillSince = now; }
    if (arrived && typeof raw === 'number' && Math.abs(raw - target) <= tol && now - r.stillSince >= 300) {
      this._endReturn(true, 'Centred.');
      this.onCentred();
    } else if (now - r.at > 6000) {
      this._endReturn(false, 'The rim did not come back to the centre — is something holding it?');
    }
  }

  cancelReturn() {
    if (this.returning) this._endReturn(false, 'Centring cancelled.');
  }

  _endReturn(ok, text) {
    this.native?.release();
    this.returning = null;
    this.lead.reset();
    this.centreResult = { ok, text, at: this.now() };
  }

  cancelCentre() {
    if (this.awaitingBase) {
      this.awaitingBase = null;
      this.centreResult = { ok: false, text: 'Calibration cancelled. Nothing was changed.', at: this.now() };
      return;
    }
    if (!this.centring) return;
    this._endCentring(false, 'Calibration cancelled. Nothing was changed.');
  }

  /** A Moza base, which can say its own rotation over its serial port. */
  get isMoza() { return /Vendor: 346e/i.test(this.deviceId ?? ''); }

  /** What to tell the driver while Calibrate waits for the base. */
  get awaitingMessage() {
    return 'Reading how far your wheel turns from the base…';
  }

  /** "−211° to +209°": the wheel's travel either side of straight ahead. */
  get travel() {
    const ends = this.mapping?.ends;
    if (!ends || !this.mapping.rotation) return null;
    const s = this.mapping.steer;
    const at = (raw) => (raw - (s.centre ?? 0)) * (s.sign ?? 1) * (this.mapping.rotation / 2);
    return { min: at(ends.left), max: at(ends.right) };
  }

  _rawSteer(pads) {
    const s = this.mapping?.steer;
    const v = pads.find((p) => p.id === s?.pad)?.axes[s.index];
    return typeof v === 'number' ? v : null;
  }

  _advanceCentring(pads, now) {
    // The motor's aim has to have reached the phase's target before the rim
    // stopping counts; on a wheel the driver turns there is no aim to wait for.
    const c = this.centring;
    const arrived = !c.drivable || Math.abs(this._centreAim - c.aim) < 1e-6;
    const raw = this._rawSteer(pads);
    const was = c.phase;
    const phase = c.update(raw, now, arrived);
    // Centred before the sweep: the rig centres with the rim, so both set
    // off from straight ahead together.
    if (was === 'start' && phase === 'left') this.onCentred();
    if (c.flipped) {
      // Pick the sweep up from where the rim actually is, so turning the
      // spring round does not throw it across to the other lock in one go.
      c.flipped = false;
      this._centreAim = raw ?? 0;
      this._sweep.reset(this._centreAim);
    }
    if (phase === 'done') {
      this.mapping = {
        ...this.mapping,
        steer: { ...this.mapping.steer, centre: c.centre },
        ends: { left: c.left, right: c.right },
        // Which way the motor runs, now that the sweep has found out.
        ffSign: c.ffSign,
      };
      this._save();
      this.degrees = 0;
      const t = this.travel;
      const fmt = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}°`;
      this._endCentring(true, `Calibrated: ${fmt(t.min)} anticlockwise to ${fmt(t.max)} clockwise, centre set.`);
      this.onCentred();
    } else if (phase === 'failed') {
      this._endCentring(false, this.centring.message);
    }
  }

  _endCentring(ok, text) {
    if (this.centring?.drivable) this.native?.release();
    this.centring = null;
    this.lead.reset();
    this.centreResult = { ok, text, at: this.now() };
  }

  /** Whether the rim has paddles that can change gear. */
  get paddlesMapped() { return !!(this.mapping?.up || this.mapping?.down); }

  /** @param {Array} [steps]  WIZARD_STEPS for everything, PADDLE_STEPS for just the paddles */
  startWizard(steps = WIZARD_STEPS) {
    if (!this.mapping) return null;
    if (this.centring) this.cancelCentre();
    this.drive(null);
    this.wizard = new MappingWizard(this.pads, this.mapping, steps);
    return this.wizard;
  }

  skipStep() {
    this.wizard?.skip();
    if (this.wizard?.finished) this._finishWizard();
  }

  cancelWizard() { this.wizard = null; }

  _finishWizard() {
    this.mapping = this.wizard.mapping;
    this.wizard = null;
    this._save();
  }

  _save() {
    if (!this.deviceId) return;
    this.store.maps[this.deviceId] = this.mapping;
    saveWheels(this.store);
  }

  _switchTo(id) {
    const was = this.deviceId;
    this.deviceId = id;
    this.wizard = null;
    this.centring = null;
    this.measuring = null;
    this.returning = null;
    this.awaitingBase = null;
    this._smooth.reset();
    this._sweepAfterMeasure = false;
    this._held = { up: false, down: false, neutral: false, reverse: false };
    this.degrees = 0;
    this.drive(null);
    this.lead.reset();
    this.leading = false;

    if (!id) {
      this.mapping = null;
      if (was) this.onDevice({ type: 'disconnected', name: displayName(was) });
      return;
    }
    const pad = this.pads.find((p) => p.id === id);
    this.mapping = this.store.maps[id] ?? defaultMapping(pad);
    this.onDevice({ type: 'connected', name: displayName(id), mapped: !!this.store.maps[id] });
  }
}
