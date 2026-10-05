/**
 * The real wheel, mirrored on its twin on screen.
 *
 * When the wheel plugged in is the wheel being shown, everything done to it
 * shows: a button held is a cap held down, a paddle pulled is a flap pulled
 * (whether or not the gearbox takes the shift), a rotary clicked round is a
 * knob turned the same number of positions.
 *
 * Each control on the model carries the number its real twin reports as
 * (`hid`, 1-based, as the maker's button guide gives it); the device's
 * button `index` is one less. A rotary that reports as a pair of buttons — a
 * click each way, as most sim-wheel encoders do — carries `hidCw` and
 * `hidCcw`.
 *
 * Presses are counted where the device keeps count (the desktop helper), so
 * a click shorter than a frame still shows; without counts (the browser), a
 * press shows while it is held.
 */
import { buttonValue } from './wheels.js';

/**
 * The controls of a wheel spec that have a real twin to follow.
 * @returns {Array<{kind: 'button'|'paddle'|'encoder', id: string, hid?: number, cw?: number, ccw?: number}>}
 */
export function mirroredControls(spec) {
  const out = [];
  for (const b of spec.buttons ?? []) if (b.hid) out.push({ kind: 'button', id: b.id, hid: b.hid });
  for (const d of spec.dpads ?? []) {
    for (const dir of ['up', 'right', 'down', 'left']) {
      if (d.ids?.[dir] && d.hid?.[dir]) out.push({ kind: 'button', id: d.ids[dir], hid: d.hid[dir] });
    }
  }
  for (const p of spec.paddles ?? []) if (p.hid) out.push({ kind: 'paddle', id: p.id, hid: p.hid });
  for (const r of spec.rotaries ?? []) {
    if (r.hidCw || r.hidCcw) out.push({ kind: 'encoder', id: r.id, cw: r.hidCw, ccw: r.hidCcw });
  }
  return out;
}

export class ControlMirror {
  constructor() {
    /** Press counts last seen, by device and button index. */
    this._seen = new Map();
    /** Whether each button was down last time, where there are no counts. */
    this._down = new Map();
  }

  /** Forgets everything — a different device, or a different model. */
  reset() {
    this._seen.clear();
    this._down.clear();
  }

  /**
   * What the twin should show this frame.
   * @param {{id: string, buttons: Array, presses?: number[]}} pad
   * @param {ReturnType<typeof mirroredControls>} controls
   * @returns {{press: string[], pull: string[], turn: Array<[string, number]>}}
   */
  read(pad, controls) {
    const out = { press: [], pull: [], turn: [] };
    // How many times a button was newly pressed since last frame, and
    // whether it is down now.
    const state = (hid) => {
      const i = hid - 1;
      const key = `${pad.id}#${i}`;
      const down = buttonValue(pad.buttons?.[i]) >= 0.5;
      const count = Array.isArray(pad.presses) ? pad.presses[i] ?? null : null;
      let fresh = 0;
      if (count !== null) {
        const seen = this._seen.get(key);
        if (seen !== undefined) fresh = Math.max(0, Math.min(8, count - seen));
        this._seen.set(key, count);
      } else {
        if (down && !this._down.get(key)) fresh = 1;
      }
      this._down.set(key, down);
      return { down, fresh };
    };
    for (const c of controls) {
      if (c.kind === 'encoder') {
        const cw = c.cw ? state(c.cw).fresh : 0;
        const ccw = c.ccw ? state(c.ccw).fresh : 0;
        if (cw !== ccw) out.turn.push([c.id, cw - ccw]);
        continue;
      }
      const { down, fresh } = state(c.hid);
      if (down || fresh) (c.kind === 'paddle' ? out.pull : out.press).push(c.id);
    }
    return out;
  }
}
