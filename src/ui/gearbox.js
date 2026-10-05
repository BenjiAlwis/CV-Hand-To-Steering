/**
 * The gear ratios, in the settings sheet: a top speed for each gear, and a
 * way back to the standard box.
 *
 * Each box is checked as a whole — a gear has to be taller than the one
 * before — and only a gearbox that makes sense is saved and handed to the
 * car. A bad entry is marked and explained, and the car keeps the last good
 * set until it is put right.
 */
import { STANDARD_RATIOS, RATIO_LIMITS, checkRatios } from '../sim/carsim.js';

export class GearboxSettings {
  /** @param {import('./settings.js').Settings} settings */
  constructor(settings) {
    this.settings = settings;
    const $ = (id) => document.getElementById(id);
    this.el = { grid: $('gearGrid'), error: $('gearError'), state: $('gearState'), reset: $('gearReset') };
    this.inputs = STANDARD_RATIOS.map((_, i) => {
      const label = document.createElement('label');
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(RATIO_LIMITS.min);
      input.max = String(RATIO_LIMITS.max);
      input.step = '1';
      input.inputMode = 'numeric';
      input.title = `gear ${i + 1}: km/h at the rev limit (standard ${STANDARD_RATIOS[i]})`;
      input.setAttribute('aria-label', `Gear ${i + 1} top speed, km/h`);
      input.addEventListener('change', () => this._commit());
      label.append(n, input);
      this.el.grid.append(label);
      return input;
    });
    this.el.reset.addEventListener('click', () => this.settings.set('gearRatios', null));
    settings.onChange((key) => { if (key === 'gearRatios') this.show(); });
    this.show();
  }

  /** The gearbox in force: the saved one if it is sound, otherwise the standard. */
  get tops() {
    const saved = this.settings.get('gearRatios');
    const check = saved ? checkRatios(saved) : null;
    return check?.ok ? check.tops : [...STANDARD_RATIOS];
  }

  show() {
    const tops = this.tops;
    this.inputs.forEach((input, i) => {
      input.value = String(tops[i]);
      input.classList.remove('bad');
      input.classList.toggle('changed', tops[i] !== STANDARD_RATIOS[i]);
    });
    this.el.error.hidden = true;
    this._state(tops);
  }

  _commit() {
    const tops = this.inputs.map((input) => input.value.trim() === '' ? NaN : Number(input.value));
    const check = checkRatios(tops);
    this.inputs.forEach((input) => input.classList.remove('bad'));
    if (!check.ok) {
      if (check.gear) this.inputs[check.gear - 1].classList.add('bad');
      this.el.error.textContent = `${check.error} Not applied — the car keeps its last gearbox until this is fixed.`;
      this.el.error.hidden = false;
      return;
    }
    const standard = check.tops.every((t, i) => t === STANDARD_RATIOS[i]);
    // Saving the standard box as null keeps "reset" and "typed it back in"
    // the same thing, and lets a later change to the standard reach it.
    this.settings.set('gearRatios', standard ? null : check.tops);
    this.show();
  }

  _state(tops) {
    const custom = tops.some((t, i) => t !== STANDARD_RATIOS[i]);
    this.el.state.textContent = custom ? 'custom gearbox' : 'standard';
    this.el.state.classList.toggle('custom', custom);
    this.el.reset.disabled = !custom;
  }
}
