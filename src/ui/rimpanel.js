/**
 * The WHEEL BASE panel: is a real wheel connected, and are the two wheels in
 * step?
 *
 * The dial carries two needles, the rig's in the team colour and the real
 * rim's in white, so whether they agree — and which one is leading — can be
 * read at a glance. The chips say what this wheel can do here: be turned by
 * the rig (FORCE), have its base settings read (BASE), change gear with its
 * paddles (PADDLES). Pedals have a panel of their own.
 *
 * SHIFT shows the last gear change and what made it — a real paddle, a
 * finger, a key — so each way of shifting can be checked by trying it.
 * Paddles that are not mapped yet are one click away: the Set up button
 * becomes Paddles, and the steps run right here on the panel.
 */
import { PADDLE_STEPS } from '../input/wheels.js';

const MODES = {
  none: '—',
  off: 'off',
  mapping: 'mapping…',
  centring: 'calibrating…',
  measuring: 'measuring…',
  returning: 'centring…',
  leading: 'rim leads',
  following: 'rim follows',
};

export class RimPanel {
  /**
   * @param {object} o
   * @param {import('../input/wheelsource.js').WheelSource} o.wheel
   * @param {import('./settings.js').Settings} o.settings
   * @param {() => void} o.onSetup  opens the settings sheet at the wheel section
   */
  constructor({ wheel, settings, onSetup }) {
    this.wheel = wheel;
    this.settings = settings;
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('rimPanel'),
      name: $('rimName'), sub: $('rimSub'),
      rimNeedle: $('rimNeedle'), rigNeedle: $('rimRigNeedle'),
      rimAngle: $('rimAngle'), rigAngle: $('rigAngle'), mode: $('rimMode'),
      ffb: $('rimChipFfb'), base: $('rimChipBase'), paddles: $('rimChipPaddles'),
      shift: $('rimShift'), prompt: $('rimPrompt'), skip: $('rimSkip'), cancel: $('rimCancel'),
      rotation: $('rimRotation'), measure: $('rimMeasure'),
      toggle: $('rimToggle'), force: $('rimForce'), setup: $('rimSetup'), centre: $('rimCentre'),
      ret: $('rimReturn'),
    };
    this.el.toggle.addEventListener('click', () => settings.set('wheel', !settings.get('wheel')));
    this.el.force.addEventListener('click', () => settings.set('wheelForce', !settings.get('wheelForce')));
    this.el.setup.addEventListener('click', () => {
      if (wheel.connected && !wheel.paddlesMapped) wheel.startWizard(PADDLE_STEPS);
      else onSetup?.();
    });
    this.el.centre.addEventListener('click', () => wheel.calibrateCentre());
    this.el.ret.addEventListener('click', () => wheel.centre());
    this.el.measure.addEventListener('click', () => wheel.measureRotation());
    this.el.skip.addEventListener('click', () => wheel.skipStep());
    this.el.cancel.addEventListener('click', () => {
      if (wheel.returning) wheel.cancelReturn();
      else if (wheel.centring || wheel.awaitingBase) wheel.cancelCentre();
      else if (wheel.measuring) wheel.cancelMeasure();
      else wheel.cancelWizard();
    });
  }

  /**
   * @param {number} rigDegrees where the rig's wheel is
   * @param {{direction: number, from: string, at: number}|null} [lastShift]
   */
  update(rigDegrees, lastShift = null) {
    const w = this.wheel;
    const { el } = this;
    const on = this.settings.get('wheel');
    const native = w.native;

    const state = !w.connected ? 'none' : on ? 'connected' : 'off';
    if (el.root.dataset.state !== state) el.root.dataset.state = state;

    setText(el.name, w.connected ? w.deviceName : native?.error ? 'wheel helper unavailable' : 'no wheel');
    setText(el.sub, !w.connected
      ? (native ? 'plug a wheel in — it is found by itself' : 'plug one in, then turn it')
      : !on ? 'connected · not steering'
        : native ? 'connected over USB' : 'connected · browser mode');

    setText(el.toggle, on ? 'Disconnect' : 'Connect');
    el.toggle.setAttribute('aria-pressed', String(on && w.connected));
    const force = this.settings.get('wheelForce');
    setText(el.force, 'Force');
    el.name.title = w.deviceName ?? '';
    el.force.setAttribute('aria-pressed', String(force && w.drivable));
    el.force.disabled = !w.drivable;
    el.force.title = !w.drivable ? 'this wheel cannot be turned from here'
      : force ? 'the rig turns the real wheel to match — click to stop' : 'click to let the rig turn the real wheel';

    // The last shift stays up long enough to read, from any input — this row
    // is how fingers and paddles are both checked.
    const shown = lastShift && performance.now() - lastShift.at < 2500;
    setText(el.shift, !shown ? '—'
      : lastShift.gear ? `${lastShift.gear} · ${lastShift.from}`
      : lastShift.refused ? `▼ ${lastShift.refused} · too fast`
        : `${lastShift.direction > 0 ? '▲ up' : '▼ down'} · ${lastShift.from}`);
    el.shift.classList.toggle('refused', !!(shown && lastShift.refused));

    const wizard = w.wizard;
    const centring = w.centring;
    const measuring = w.measuring;
    const awaiting = w.awaitingBase;
    const returning = w.returning;
    const busy = !!(wizard || centring || measuring || awaiting || returning);
    // How the last centring or measuring went stays up for a few seconds, then clears.
    const latest = [w.centreResult, w.measureResult].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    const result = !busy && latest && performance.now() - latest.at < 6000 ? latest : null;
    el.cancel.hidden = !busy;
    el.skip.hidden = !wizard;
    el.toggle.hidden = el.force.hidden = el.setup.hidden = el.centre.hidden = el.ret.hidden = busy;
    if (wizard) {
      const n = Math.min(wizard.step + 1, wizard.steps.length);
      setText(el.prompt, wizard.listening && wizard.current
        ? `${n}/${wizard.steps.length} · ${wizard.current.prompt}`
        : 'Got it — let go…');
      tone(el.prompt, 'ask');
    } else if (returning) {
      setText(el.prompt, 'Centring — hands off the rim…');
      tone(el.prompt, 'ask');
    } else if (awaiting) {
      setText(el.prompt, w.awaitingMessage);
      tone(el.prompt, 'ask');
    } else if (centring || measuring) {
      setText(el.prompt, (centring ?? measuring).message);
      tone(el.prompt, 'ask');
    } else if (result) {
      setText(el.prompt, result.text);
      tone(el.prompt, result.ok ? 'ok' : 'warn');
    } else if (w.connected && !w.rotationKnown) {
      // Never quietly: an unknown rotation turns the rig the wrong distance.
      setText(el.prompt, 'This wheel has not said how far it turns, so the rig can turn further than the rim. Click Calibrate.');
      tone(el.prompt, 'warn');
    }
    el.prompt.hidden = !busy && !result && !(w.connected && !w.rotationKnown);
    el.centre.disabled = !w.connected || !on;
    el.ret.disabled = !w.connected || !on;
    el.ret.title = !w.connected ? 'no wheel connected'
      : w.drivable ? 'turn the rim back to straight ahead, and the rig with it'
        : 'take where the rim is now as straight ahead (this wheel cannot be turned from here)';
    el.centre.title = !w.connected ? 'no wheel connected'
      : w.drivable ? 'sweep the rim to full lock each way and back to centre, and make those the ends and 0°'
        : 'turn the rim to full lock each way and back to centre when asked (this wheel cannot be turned from here)';
    const needsPaddles = w.connected && !w.paddlesMapped;
    setText(el.setup, needsPaddles ? 'Paddles' : 'Set up');
    el.setup.title = needsPaddles ? 'map the wheel\'s shift paddles — pull each one when asked' : 'wheel settings';

    el.measure.disabled = busy || !w.connected;
    if (w.mapping) {
      // In amber with a question mark while it is only a guess: that is the
      // number that decides how far the rig turns for each degree of rim.
      // With a calibration, the travel either side; otherwise the rotation.
      const t = w.rotationKnown ? w.travel : null;
      const r = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;
      setText(el.rotation, t ? `${r(t.min)}° / ${r(t.max)}°` : `${w.mapping.rotation}°${w.rotationKnown ? '' : ' ?'}`);
      el.rotation.classList.toggle('assumed', !w.rotationKnown);
      el.rotation.title = w.rotationKnown ? 'lock to lock' : 'a guess — measure it so the rig turns as far as the rim';
    }

    if (!w.connected) return;

    // The needles turn as far as the wheels do — past ±180° they come round
    // again, as a real rim's spoke would; the numbers beside them say how far.
    const rim = w.degrees;
    el.rimNeedle.style.transform = `translateX(-50%) rotate(${rim}deg)`;
    el.rigNeedle.style.transform = `translateX(-50%) rotate(${rigDegrees}deg)`;
    setText(el.rimAngle, signed(rim));
    setText(el.rigAngle, signed(rigDegrees));
    setText(el.mode, MODES[w.mode] ?? w.mode);

    chip(el.ffb, w.drivable && force);
    const moza = native?.moza.state;
    chip(el.base, w.baseConnected ? true : moza === 'busy' ? 'busy' : false);
    el.base.title = moza === 'busy' ? `${native.moza.holder ?? 'another program'} has the base's serial port` : '';
    chip(el.paddles, w.paddlesMapped);
    el.paddles.title = w.paddlesMapped ? '' : 'not mapped yet — click Paddles';
  }
}

const signed = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}°`;

function chip(node, value) {
  const v = String(value);
  if (node.dataset.on !== v) node.dataset.on = v;
}

function tone(node, value) {
  if (node.dataset.tone !== value) node.dataset.tone = value;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
