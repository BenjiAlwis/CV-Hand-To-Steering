/**
 * What the driver has turned on, and where they want it.
 *
 * Everything in here is a preference rather than state: it survives a restart,
 * because being asked to switch the pedals back on every launch would be worse
 * than not being able to switch them off. Storage failing is not an error —
 * in a private window the settings simply stop persisting, and the rig runs on
 * the defaults.
 */
const STORE_KEY = 'wheelhouse.settings';

/**
 * Settings that start off at every launch, whatever they were left at. A car
 * that drives off by itself the moment the rig opens is a surprise, so the
 * driving aids are switched on per session, never remembered.
 */
export const SESSION_ONLY = ['autoGears', 'autoThrottle', 'autoBrake', 'queueDown', 'traction', 'abs', 'rimGuard'];

export const DEFAULTS = {
  /** Gear flaps pulled with a finger. */
  flaps: true,
  /** Throttle and brake read from the driver's feet. */
  pedals: true,
  /** Outline what the trackers found, in both camera views. */
  boxes: false,
  /** Loosen the hand model for gloves, where it cannot read skin. */
  gloves: false,
  /** Steer with a wheel plugged into the machine, whenever one is found. */
  wheel: true,
  /** Let the rig turn a force-feedback rim to match it, and how hard. */
  wheelForce: true,
  wheelStrength: 0.3,
  /**
   * The motor only turns a base with a wheel shown to be fitted. Back on at
   * every launch, however it was left: turning it off is a choice made for
   * one session, never a setting that lingers.
   */
  rimGuard: true,
  /** Drive the car with pedals plugged into the machine, whenever they are found. */
  pedalSet: true,
  /** The automatic gearbox. */
  autoGears: false,
  /** The car accelerates by itself toward whatever speed the corner allows. */
  autoThrottle: false,
  /** The car brakes by itself when going faster than the corner allows. */
  autoBrake: false,
  /** A downshift refused for speed waits and lands once the car has slowed. */
  queueDown: false,
  /** Never lets the rear tyres spin under power. Banned in F1 since 2008. */
  traction: false,
  /** Never lets the tyres lock under braking. Not allowed in F1. */
  abs: false,
  /** Graphics quality: low, medium, high or ultra. */
  graphics: 'high',
  /**
   * Panels the driver has rolled up. Camera panels keep tracking while rolled.
   * The key list starts rolled up: it is reference, not something to watch.
   */
  collapsed: { controls: true },
  /**
   * Panels hidden outright. The car readout starts hidden — it is for
   * looking under the hood, not for driving by.
   */
  hidden: { car: true },
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS, collapsed: { ...DEFAULTS.collapsed }, hidden: { ...DEFAULTS.hidden } };
    this._listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        for (const key of SESSION_ONLY) delete raw[key];
        this.values = {
          ...DEFAULTS,
          ...raw,
          // Defaults first, so a panel that starts rolled up does so for a
          // driver who has never touched it — and a stored choice wins.
          collapsed: { ...DEFAULTS.collapsed, ...(raw.collapsed ?? {}) },
          hidden: { ...DEFAULTS.hidden, ...(raw.hidden ?? {}) },
        };
      }
    } catch { /* nothing stored yet, or storage is unavailable */ }
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.values));
    } catch { /* private window, or storage is full — the choice just will not stick */ }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    this._emit(key, value);
  }

  /** @param {'collapsed'|'hidden'} group */
  setPanel(group, id, value) {
    // Stored either way, not deleted when false: a panel that starts rolled
    // up and was opened has to stay open, which an absent key cannot say.
    const next = { ...this.values[group], [id]: !!value };
    this.values[group] = next;
    this.save();
    this._emit(group, next);
  }

  isPanel(group, id) { return !!this.values[group]?.[id]; }

  /** @param {(key: string, value: any) => void} fn */
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  _emit(key, value) { for (const fn of this._listeners) fn(key, value); }
}
