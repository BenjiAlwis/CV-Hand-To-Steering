/**
 * The PEDAL SET panel, and the pedal section of the settings sheet.
 *
 * The panel answers the three questions a driver has about real pedals: are
 * they connected, does pressing one register, and are they what is driving
 * the car right now — rather than the foot camera, or the car itself.
 * Calibration runs here too, step by step, so the bars can be watched while
 * each pedal is pressed.
 */
import { PEDAL_STEPS } from '../input/wheels.js';

const SUB = {
  none: 'plug a pedal set in',
  off: 'connected · not in use',
  unmapped: 'connected · press Calibrate to set up',
  mapping: 'calibrating…',
  waiting: 'connected · press a pedal to drive',
  driving: 'connected · driving the car',
};

const CAR = { pedals: 'your pedals', feet: 'the foot camera', aids: 'driving aids', none: 'nobody — parked' };

export class PedalSetPanel {
  /**
   * @param {object} o
   * @param {import('../input/pedalset.js').PedalSet} o.pedals
   * @param {import('./settings.js').Settings} o.settings
   */
  constructor({ pedals, settings }) {
    this.pedals = pedals;
    this.settings = settings;
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('pedalSetPanel'), name: $('pedalSetName'), sub: $('pedalSetSub'),
      throttle: $('psThrottle'), throttleValue: $('psThrottleValue'),
      brake: $('psBrake'), brakeValue: $('psBrakeValue'),
      clutch: $('psClutch'), clutchValue: $('psClutchValue'),
      car: $('psCar'), prompt: $('psPrompt'),
      toggle: $('psToggle'), calibrate: $('psCalibrate'), skip: $('psSkip'), cancel: $('psCancel'),
      // settings sheet
      enabled: $('setPedalSet'), device: $('pedalSetDevice'), note: $('pedalSetNote'), reset: $('pedalSetReset'),
    };

    this.el.toggle.addEventListener('click', () => settings.set('pedalSet', !settings.get('pedalSet')));
    this.el.calibrate.addEventListener('click', () => pedals.startWizard());
    this.el.skip.addEventListener('click', () => pedals.skipStep());
    this.el.cancel.addEventListener('click', () => pedals.cancelWizard());

    this.el.enabled.checked = settings.get('pedalSet');
    this.el.enabled.addEventListener('change', () => settings.set('pedalSet', this.el.enabled.checked));
    settings.onChange((key, value) => { if (key === 'pedalSet') this.el.enabled.checked = value; });
    this.el.device.addEventListener('change', () => pedals.select(this.el.device.value || null));
    this.el.reset.addEventListener('click', () => pedals.resetMapping());

    this._deviceKey = '';
  }

  /** @param {'pedals'|'feet'|'aids'|'none'} driver what the car is taking its pedals from */
  update(driver) {
    const p = this.pedals;
    const { el } = this;
    const state = p.state;
    if (el.root.dataset.state !== state) el.root.dataset.state = state;

    setText(el.name, p.connected ? p.deviceName : 'no pedals');
    el.name.title = p.deviceName ?? '';
    setText(el.sub, SUB[state]);
    setText(el.car, CAR[driver] ?? '—');

    const wizard = p.wizard;
    const shown = wizard ? wizard.result : p.mapping;
    for (const key of ['throttle', 'brake', 'clutch']) {
      const bound = !!shown?.[key];
      const value = bound ? p[key] : 0;
      el[key].style.width = `${value * 100}%`;
      el[key].classList.toggle('pressed', value > 0.9);
      setText(el[`${key}Value`], bound ? `${Math.round(value * 100)}%` : 'unset');
      // Which input each pedal is, on hover; and while calibrating, which row is being asked for.
      const row = el[key].closest('.pedal-row');
      row.title = bound ? `${key}: ${p.label(key)}` : `${key}: not set`;
      row.classList.toggle('asking', !!wizard && wizard.current?.key === key);
    }

    const on = this.settings.get('pedalSet');
    setText(el.toggle, on ? 'Disconnect' : 'Connect');
    el.toggle.setAttribute('aria-pressed', String(on && p.connected));
    el.calibrate.disabled = !p.connected;

    const summary = !wizard && p.summary && performance.now() - p.summary.at < 6000 ? p.summary : null;
    el.prompt.hidden = !wizard && !summary;
    el.skip.hidden = el.cancel.hidden = !wizard;
    el.toggle.hidden = el.calibrate.hidden = !!wizard;
    if (wizard) {
      const n = Math.min(wizard.step + 1, PEDAL_STEPS.length);
      const notice = wizard.notice;
      let text, tone;
      if (notice?.tone === 'warn') {
        // A round that did not count says why, and stays up until the next one does.
        text = notice.text; tone = 'warn';
      } else if (wizard.pressing) {
        text = notice?.text ?? 'Let the pedal come all the way up…'; tone = 'ok';
      } else if (wizard.listening && wizard.current) {
        text = `${notice ? `${notice.text} ` : ''}${wizard.current.prompt}`; tone = 'ask';
      } else {
        text = 'Let go of every pedal…'; tone = 'ask';
      }
      setText(el.prompt, `${n}/${PEDAL_STEPS.length} · ${text}`);
      if (el.prompt.dataset.tone !== tone) el.prompt.dataset.tone = tone;
    } else if (summary) {
      setText(el.prompt, summary.text);
      if (el.prompt.dataset.tone !== 'ok') el.prompt.dataset.tone = 'ok';
    }
  }

  /** The settings sheet's part. Call while it is open. */
  updateSettings() {
    const p = this.pedals;
    const { el } = this;
    const key = `${p.devices.map((d) => d.id).join('|')}→${p.deviceId}`;
    if (key !== this._deviceKey) {
      this._deviceKey = key;
      el.device.innerHTML = '';
      if (!p.deviceId) el.device.append(new Option(p.pads.length ? 'choose a device…' : 'nothing connected', ''));
      for (const d of p.devices) {
        const tag = d.known ? ' (known layout)' : d.pedals || d.wheel ? '' : ' (not pedals)';
        el.device.append(new Option(`${d.name}${tag}`, d.id));
      }
      el.device.value = p.deviceId ?? '';
      el.device.disabled = p.pads.length === 0;
    }
    el.reset.disabled = !p.connected;
    setText(el.note, !p.connected
      ? 'No pedals found. Plug them in — through the wheel base or on their own cable.'
      : p.devices.find((d) => d.id === p.deviceId)?.known
        ? 'A Moza layout, mapped from Boxflat\'s records — no setup needed. Calibrate to measure your pedals\' exact travel.'
        : p.mapped ? 'Mapped. Calibrate again if a pedal reads wrong.'
          : 'Not mapped yet. Press Calibrate on the PEDAL SET panel and press each pedal when asked.');
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
