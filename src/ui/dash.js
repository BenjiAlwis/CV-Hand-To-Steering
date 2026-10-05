/**
 * The dash: speed, gear, revs and the lap, in a strip across the bottom (or
 * top) of the scene.
 *
 * An F1 wheel carries its own display, so it is not needed there. A sim
 * wheel like Moza's ES has no screen at all — nothing on it says what gear
 * the car is in — and the dash stands in for one. On `auto` (the default)
 * it follows the wheel on screen: shown for a wheel with no display of its
 * own, hidden for one with. `on` and `off` override that either way.
 */

/** Shift lights across the top of the dash, coloured as the cars' are. */
const LIGHTS = 15;
const COLOURS = ['green', 'green', 'green', 'green', 'green', 'red', 'red', 'red', 'red', 'red',
  'blue', 'blue', 'blue', 'blue', 'blue'];

/**
 * Whether the dash should be showing.
 * @param {'auto'|'on'|'off'} mode
 * @param {object|null} spec the wheel on screen
 */
export function dashShown(mode, spec) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  // Auto: only a wheel with nowhere of its own to show the gear.
  return !spec?.screen;
}

export class Dash {
  /** @param {import('./settings.js').Settings} settings */
  constructor(settings) {
    this.settings = settings;
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('dash'), speed: $('dashSpeed'), gear: $('dashGear'), lap: $('dashLap'), delta: $('dashDelta'),
      revs: $('dashRevs'), thr: $('dashThr'), brk: $('dashBrk'), rpm: $('dashRpm'),
    };
    this.lights = Array.from({ length: LIGHTS }, (_, i) => {
      const led = document.createElement('i');
      led.dataset.colour = COLOURS[i];
      this.el.revs.append(led);
      return led;
    });
    this._last = {};

    // The same setting, offered in two places: general and wheel settings.
    for (const id of ['setDash', 'wheelDash']) {
      const select = $(id);
      if (!select) continue;
      select.value = settings.get('dash');
      select.addEventListener('change', () => settings.set('dash', select.value));
    }
    const pos = $('setDashPosition');
    if (pos) {
      pos.value = settings.get('dashPosition');
      pos.addEventListener('change', () => settings.set('dashPosition', pos.value));
    }
    settings.onChange((key, value) => {
      if (key === 'dash') for (const id of ['setDash', 'wheelDash']) { const s = $(id); if (s) s.value = value; }
      if (key === 'dashPosition' && pos) pos.value = value;
    });
  }

  /**
   * @param {object} t the car's telemetry
   * @param {object|null} spec the wheel on screen
   */
  update(t, spec) {
    const shown = dashShown(this.settings.get('dash'), spec);
    this._set('shown', shown, () => { this.el.root.hidden = !shown; });
    if (!shown) return;
    const position = this.settings.get('dashPosition');
    this._set('position', position, () => { this.el.root.dataset.position = position; });

    const gear = t.gearLabel ?? 'N';
    this._set('gear', gear, () => {
      this.el.gear.textContent = gear;
      this.el.gear.dataset.kind = gear === 'N' ? 'neutral' : gear === 'R' ? 'reverse' : 'gear';
    });
    const speed = String(Math.round(t.speed ?? 0));
    this._set('speed', speed, () => { this.el.speed.textContent = speed; });
    const lap = formatLap(t.lapTime ?? 0);
    this._set('lap', lap, () => { this.el.lap.textContent = lap; });
    const d = t.delta ?? 0;
    const delta = `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
    this._set('delta', delta, () => {
      this.el.delta.textContent = delta;
      this.el.delta.dataset.tone = d <= 0 ? 'ahead' : 'behind';
    });
    const rpm = `${Math.round((t.rpm ?? 0) / 100) * 100}`;
    this._set('rpm', rpm, () => { this.el.rpm.textContent = rpm; });

    // The lights fill with the revs and all flash together at the shift
    // point, as the wheels' own do.
    const f = t.rpmFraction ?? 0;
    const flash = f > 0.965 ? Math.sin(performance.now() * 0.048) > 0 : null;
    for (let i = 0; i < LIGHTS; i++) {
      const on = flash === null ? f >= (i + 1) / (LIGHTS + 1) : flash;
      const state = flash === null ? (on ? 'on' : 'off') : (on ? 'flash' : 'off');
      if (this.lights[i].dataset.state !== state) this.lights[i].dataset.state = state;
    }

    this.el.thr.style.width = `${Math.round((t.throttle ?? 0) * 100)}%`;
    this.el.brk.style.width = `${Math.round((t.brake ?? 0) * 100)}%`;
  }

  /** Touches the DOM only when a value actually changes. */
  _set(key, value, apply) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    apply();
  }
}

function formatLap(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
