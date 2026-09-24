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

export const DEFAULTS = {
  /** Gear flaps pulled with a finger. */
  flaps: true,
  /** Throttle and brake read from the driver's feet. */
  pedals: true,
  /** Outline what the trackers found, in both camera views. */
  boxes: false,
  /** Loosen the hand model for gloves, where it cannot read skin. */
  gloves: false,
  /** Panels the driver has rolled up. Camera panels keep tracking while rolled. */
  collapsed: {},
  /** Panels hidden outright. */
  hidden: {},
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS, collapsed: {}, hidden: {} };
    this._listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        this.values = {
          ...DEFAULTS,
          ...raw,
          collapsed: { ...(raw.collapsed ?? {}) },
          hidden: { ...(raw.hidden ?? {}) },
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
    const next = { ...this.values[group] };
    if (value) next[id] = true; else delete next[id];
    this.values[group] = next;
    this.save();
    this._emit(group, next);
  }

  isPanel(group, id) { return !!this.values[group]?.[id]; }

  /** @param {(key: string, value: any) => void} fn */
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  _emit(key, value) { for (const fn of this._listeners) fn(key, value); }
}
