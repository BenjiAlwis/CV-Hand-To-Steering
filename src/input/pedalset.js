/**
 * Real pedals — throttle, brake and clutch — plugged into the machine.
 *
 * A device of their own, separate from the wheel, because they often are: a
 * pedal set on its own USB cable, or a wheel used with no pedals at all. When
 * they plug into the wheel's base, as most do, this simply reads the same
 * device the wheel does.
 *
 * Moza pedals work with no setup at all: their axes are known, by evdev code,
 * from Boxflat's records, and the desktop helper reports codes. Anything else
 * is mapped once by the pedal wizard, which also measures how far each pedal
 * really travels.
 *
 * Pedals never take the car away on their own. Plugged in and untouched, the
 * car keeps driving itself; the first press hands it over. A pedal set that
 * is unplugged, switched off or being mapped hands it straight back.
 */
import {
  choosePedalDevice, defaultPedals, displayName, hasPedalLayout, isLikelyPedals, isLikelyWheel,
  loadPedals, savePedals, loadWheels, pedalValue, MappingWizard, PEDAL_STEPS, PEDAL_KEYS,
  uniquePedals, inputLabel,
} from './wheels.js';

export class PedalSet {
  /**
   * @param {object} o
   * @param {() => Array} [o.getPads]  stands in for the hardware in tests
   * @param {import('./nativewheels.js').NativeWheels} [o.native]
   * @param {() => object|null} [o.getSteer]  the wheel's steering binding, kept out of the pedal wizard
   * @param {(event: {type: string, name: string, ready: boolean}) => void} [o.onDevice]
   */
  constructor({ getPads, native = null, getSteer, onDevice } = {}) {
    this.name = 'pedal set';
    this.enabled = true;
    this.native = native;
    this.getPads = getPads ?? (native
      ? () => native.pads
      : () => [...(navigator.getGamepads?.() ?? [])]);
    this.getSteer = getSteer ?? (() => null);
    this.onDevice = onDevice ?? (() => {});

    this.store = loadPedals();
    this._adoptWheelPedals();

    this.pads = [];
    this.deviceId = null;
    /** @type {{throttle: object|null, brake: object|null, clutch: object|null} | null} */
    this.mapping = null;
    this.wizard = null;

    /** 0…1 each. Clutch is read and shown, but the car has no use for it yet. */
    this.throttle = 0;
    this.brake = 0;
    this.clutch = 0;
    /** A pedal has been pressed since this set connected, so it is driving the car. */
    this.live = false;
    /** How the last calibration came out, for the panel to show for a moment. */
    this.summary = null;
  }

  get connected() { return this.deviceId !== null; }
  get deviceName() { return this.deviceId ? displayName(this.deviceId) : null; }
  get mapped() { return !!(this.mapping?.throttle || this.mapping?.brake); }

  /** Every device that could carry pedals, for the settings picker. */
  get devices() {
    return this.pads.map((p) => ({
      id: p.id, name: displayName(p.id),
      known: hasPedalLayout(p), pedals: isLikelyPedals(p.id), wheel: isLikelyWheel(p.id),
    }));
  }

  /** For the panel: none · off · unmapped · mapping · waiting · driving. */
  get state() {
    if (!this.connected) return 'none';
    if (!this.enabled) return 'off';
    if (this.wizard) return 'mapping';
    if (!this.mapped) return 'unmapped';
    return this.live ? 'driving' : 'waiting';
  }

  poll() {
    let pads;
    try { pads = this.getPads().filter(Boolean); } catch { pads = []; }
    this.pads = pads;

    const id = choosePedalDevice(pads, this.store.last);
    if (id !== this.deviceId) this._switchTo(id);

    if (this.wizard) {
      this.wizard.feed(pads);
      if (this.wizard.finished) this._finishWizard();
    }

    // While calibrating, the bars read what is being learned, so the pedal
    // just found can be seen moving under the foot that pressed it.
    const shown = this.wizard ? this.wizard.result : this.mapping;
    if (!shown) {
      this.throttle = this.brake = this.clutch = 0;
      return;
    }
    this.throttle = pedalValue(shown.throttle, pads) ?? 0;
    this.brake = pedalValue(shown.brake, pads) ?? 0;
    this.clutch = pedalValue(shown.clutch, pads) ?? 0;
    if (this.enabled && !this.wizard && (this.throttle > 0 || this.brake > 0)) this.live = true;
  }

  /** For the sim: throttle and brake once a pedal has been pressed, or null to let the car drive itself. */
  pedals() {
    if (this.state !== 'driving') return null;
    return { throttle: this.throttle, brake: this.brake };
  }

  /** "ABS_Z" and the like: which input each pedal is read from, for the panel. */
  label(key) { return inputLabel(this.mapping?.[key], this.pads); }

  /** Reads pedals from a particular device, remembered across restarts. */
  select(id) {
    this.store.last = id;
    savePedals(this.store);
    this.poll();
  }

  startWizard() {
    if (!this.connected) return null;
    // The steering axis is passed in so turning the wheel by accident during
    // a pedal step is not taken for a pedal, and taken out again afterwards.
    const base = { ...this.mapping, steer: this.getSteer() };
    this.wizard = new MappingWizard(this.pads, base, PEDAL_STEPS);
    this.live = false;
    this.summary = null;
    return this.wizard;
  }

  skipStep() {
    this.wizard?.skip();
    if (this.wizard?.finished) this._finishWizard();
  }

  cancelWizard() { this.wizard = null; }

  /** Back to the known layout for this device, or to unmapped if there is none. */
  resetMapping() {
    const pad = this.pads.find((p) => p.id === this.deviceId);
    if (!pad) return;
    this.mapping = defaultPedals(pad);
    delete this.store.maps[this.deviceId];
    savePedals(this.store);
    this.live = false;
  }

  _finishWizard() {
    const { throttle = null, brake = null, clutch = null } = this.wizard.mapping;
    this.mapping = { throttle, brake, clutch };
    this.wizard = null;
    this.summary = {
      at: performance.now(),
      text: `Calibrated — throttle ${this.label('throttle')}, brake ${this.label('brake')}, clutch ${this.label('clutch')}.`,
    };
    this.live = false;
    if (this.deviceId) {
      this.store.maps[this.deviceId] = this.mapping;
      savePedals(this.store);
    }
  }

  _switchTo(id) {
    const was = this.deviceId;
    this.deviceId = id;
    this.wizard = null;
    this.live = false;
    if (!id) {
      this.mapping = null;
      if (was) this.onDevice({ type: 'disconnected', name: displayName(was), ready: false });
      return;
    }
    const pad = this.pads.find((p) => p.id === id);
    // One pedal per job, whatever was stored — a mapping saved before that
    // rule existed could still have one pedal down as throttle and brake.
    this.mapping = uniquePedals(this.store.maps[id] ?? defaultPedals(pad));
    this.onDevice({ type: 'connected', name: displayName(id), ready: this.mapped });
  }

  /**
   * Pedals used to be mapped as part of the wheel. A driver who did that
   * should not have to do it again, so the first time this runs with nothing
   * of its own stored, it takes them over.
   */
  _adoptWheelPedals() {
    if (Object.keys(this.store.maps).length) return;
    for (const map of Object.values(loadWheels().maps)) {
      const found = PEDAL_KEYS.map((k) => map?.[k]).find(Boolean);
      if (!found) continue;
      this.store.maps[found.pad] = { throttle: map.throttle ?? null, brake: map.brake ?? null, clutch: null };
    }
  }
}
