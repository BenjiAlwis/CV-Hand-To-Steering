/**
 * Wheels as the desktop shell's hardware helper sees them.
 *
 * It hands over the same shape the Gamepad API does — `{id, axes, buttons}`,
 * axes −1…1 — so everything in `wheels.js` works on either without knowing
 * which it has. What it adds is the other direction: a wheel with force
 * feedback can be told where to go, and a Moza base can be asked for and
 * given its settings.
 *
 * Only present inside the desktop shell, and only on Linux. In a browser tab
 * `NativeWheels.bridge` is null and the rig reads wheels through the Gamepad
 * API alone.
 */
export class NativeWheels {
  /** The preload's channel, if this page is running inside the desktop shell. */
  static get bridge() {
    return typeof window !== 'undefined' ? window.wheelhouseHardware ?? null : null;
  }

  /**
   * @param {object} bridge  `{send, onMessage}`
   * @param {{onChange?: () => void}} [o]  something about the devices or the base changed
   */
  constructor(bridge, { onChange } = {}) {
    this.bridge = bridge;
    this.onChange = onChange ?? (() => {});
    /** @type {Map<string, {id: string, name: string, ff: boolean, mapping: string, axes: number[], buttons: number[]}>} */
    this.devices = new Map();
    /** What the helper knows about a Moza base on the serial port. */
    this.moza = { state: 'absent', holder: null, values: {} };
    /** The last answer to "is a wheel fitted to the base?", and when it came. */
    this.rim = null;
    /** The rim's shift LEDs: null until asked, then the helper's answer. */
    this.leds = null;
    this._ledMask = -1;
    this._ledAt = 0;
    /** Force feedback: which device is being driven, or why it cannot be. */
    this.ff = { state: 'released', id: null, message: null };
    this.ready = false;
    this.error = null;

    this._sent = { id: null, centre: NaN, strength: NaN, at: 0 };
    bridge.onMessage((message) => this._receive(message));
  }

  /** Snapshots for `wheels.js`. */
  get pads() { return [...this.devices.values()]; }

  /** Whether this device can be turned by the rig. */
  canDrive(id) { return !!this.devices.get(id)?.ff; }

  /**
   * Moves the rim's spring to `centre` (−1…1 of the axis) at `strength` (0…1).
   *
   * Sent at most every 16 ms and only when something has changed, so a still
   * target costs nothing on the USB bus.
   */
  follow(id, centre, strength) {
    const now = performance.now();
    const s = this._sent;
    const same = s.id === id && Math.abs(s.centre - centre) < 0.0004 && s.strength === strength;
    if (same || now - s.at < 16) return;
    Object.assign(s, { id, centre, strength, at: now });
    this.bridge.send({ op: 'follow', id, centre, strength });
  }

  release() {
    if (this._sent.id === null) return;
    this._sent = { id: null, centre: NaN, strength: NaN, at: 0 };
    this.bridge.send({ op: 'release' });
  }

  mozaRead(names) { this.bridge.send({ op: 'moza-read', names }); }
  /** Asks a Moza base, read-only, whether a wheel is fitted to it. */
  probeRim() { this.bridge.send({ op: 'rim-probe' }); }

  /** Finds the rim's shift LEDs (read-only) so the rig can drive them. */
  ledsStart() {
    this.leds = { state: 'finding' };
    this._ledMask = -1;
    this.bridge.send({ op: 'leds-start' });
  }

  /**
   * Lights the rim's LEDs, bit i for LED i from the left. Sent when the
   * pattern changes — never faster than 60 a second — and repeated every
   * half second, so a reply lost alongside another program is put right.
   */
  sendLeds(mask, now = performance.now()) {
    if (this.leds?.state !== 'ok') return;
    const changed = mask !== this._ledMask;
    if ((changed && now - this._ledAt >= 1000 / 60) || now - this._ledAt >= 500) {
      this.bridge.send({ op: 'leds', mask });
      this._ledMask = mask;
      this._ledAt = now;
    }
  }

  /** Puts the rim's LEDs out and stops driving them. */
  ledsStop() {
    if (!this.leds) return;
    this.bridge.send({ op: 'leds-stop' });
    this.leds = null;
  }
  mozaWrite(name, value) { this.bridge.send({ op: 'moza-write', name, value }); }

  _receive(message) {
    switch (message.t) {
      case 'devices': {
        const next = new Map();
        for (const d of message.list) {
          const had = this.devices.get(d.id);
          next.set(d.id, had ?? {
            id: d.id, name: d.name, ff: d.ff, mapping: '', codes: d.codes ?? null,
            axes: new Array(d.axes).fill(0), buttons: new Array(d.buttons).fill(0),
          });
          next.get(d.id).ff = d.ff;
        }
        this.devices = next;
        this.ready = true;
        // A device that has gone takes its spring with it, but our record of
        // having sent one has to go too, or the next follow would be skipped.
        if (this._sent.id && !next.has(this._sent.id)) this._sent.id = null;
        this.onChange();
        break;
      }
      case 'input': {
        const d = this.devices.get(message.id);
        if (!d) break;
        d.axes = message.axes;
        const buttons = new Array(d.buttons.length).fill(0);
        for (const i of message.down) buttons[i] = 1;
        d.buttons = buttons;
        // Presses counted by the helper, so none is lost between frames.
        if (message.presses) d.presses = message.presses;
        break;
      }
      case 'moza':
        this.moza = { state: message.state, holder: message.holder, values: { ...message.values } };
        this.onChange();
        break;
      case 'leds':
        if (message.state !== 'off') this.leds = { ...message };
        this.onChange();
        break;
      case 'rim':
        this.rim = { present: message.present, at: performance.now() };
        this.onChange();
        break;
      case 'ff':
        this.ff = { state: message.state, id: message.id, message: message.message ?? null };
        if (message.state === 'error') this._sent.id = null;
        this.onChange();
        break;
      case 'unavailable':
        this.error = message.message;
        this.onChange();
        break;
      default:
        break;
    }
  }
}
