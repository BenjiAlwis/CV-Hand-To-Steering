/**
 * The steering-wheel section of the settings sheet.
 *
 * Its job is to make "is my wheel working?" answerable at a glance: whether
 * one has been found, what it is called, and a live bar for the rim, so a
 * wheel that turns the wrong way is obvious before the driver ever sits down
 * to drive.
 */
import { ROTATIONS } from '../input/wheels.js';
import { LOCK_DEGREES } from '../wheel/spec.js';

export class WheelPanel {
  /**
   * @param {object} o
   * @param {import('../input/wheelsource.js').WheelSource} o.wheel
   * @param {import('./settings.js').Settings} o.settings
   */
  constructor({ wheel, settings }) {
    this.wheel = wheel;
    this.settings = settings;
    const $ = (id) => document.getElementById(id);
    this.el = {
      enabled: $('setWheel'),
      status: $('wheelStatus'),
      live: $('wheelLive'),
      device: $('wheelDevice'),
      rotation: $('wheelRotation'),
      rotations: $('wheelRotations'),
      measure: $('wheelMeasure'),
      rotationNote: $('wheelRotationNote'),
      steerBar: $('wheelSteerBar'), steerValue: $('wheelSteerValue'),
      prompt: $('wheelPrompt'),
      map: $('wheelMap'), skip: $('wheelSkip'), cancel: $('wheelCancel'),
      centre: $('wheelCentre'), reset: $('wheelReset'),
      force: $('setWheelForce'), strength: $('wheelStrength'), strengthValue: $('wheelStrengthValue'),
      base: $('wheelBase'), baseNote: $('wheelBaseNote'),
      baseRotation: $('baseRotation'), baseFfb: $('baseFfb'), baseTemp: $('baseTemp'),
      matchF1: $('baseMatchF1'),
    };

    this.el.enabled.checked = settings.get('wheel');
    this.el.enabled.addEventListener('change', () => settings.set('wheel', this.el.enabled.checked));

    // Any value, not only the common ones: a base can be set to 420° as
    // easily as to 900°, and a rotation that cannot be entered cannot be fixed.
    for (const deg of ROTATIONS) this.el.rotations.append(new Option(`${deg}°`, String(deg)));
    this.el.rotation.addEventListener('change', () => {
      const deg = Number(this.el.rotation.value);
      if (deg >= 90 && deg <= 2700) wheel.setRotation(deg);
    });
    this.el.measure.addEventListener('click', () => wheel.measureRotation());
    this.el.device.addEventListener('change', () => wheel.select(this.el.device.value || null));

    this.el.map.addEventListener('click', () => wheel.startWizard());
    this.el.skip.addEventListener('click', () => wheel.skipStep());
    this.el.cancel.addEventListener('click', () => wheel.cancelWizard());
    this.el.centre.addEventListener('click', () => wheel.calibrateCentre());
    this.el.reset.addEventListener('click', () => wheel.resetMapping());

    this.el.force.checked = settings.get('wheelForce');
    this.el.force.addEventListener('change', () => settings.set('wheelForce', this.el.force.checked));
    this.el.strength.value = String(settings.get('wheelStrength'));
    this.el.strength.addEventListener('input', () => settings.set('wheelStrength', Number(this.el.strength.value)));
    // Lock to lock on the base equal to the rig's, so the rim stops where the rig does.
    this.el.matchF1.addEventListener('click', () => wheel.setRotation(LOCK_DEGREES * 2));
    // The HUD buttons change these too, so the boxes follow the settings.
    settings.onChange((key, value) => {
      if (key === 'wheel') this.el.enabled.checked = value;
      if (key === 'wheelForce') this.el.force.checked = value;
    });

    this._deviceKey = '';
  }

  /** Call every frame while the sheet is open; it only writes what changed. */
  update() {
    const w = this.wheel;
    const { el } = this;

    const status = w.connected
      ? `${w.deviceName} — connected${this.settings.get('wheel') ? '' : ', but switched off above'}`
      : w.pads.length
        ? 'A controller is connected but does not look like a wheel. Pick it below to steer with it anyway.'
        : 'No wheel found. Plug it in, then turn it or press a button — browsers keep controllers hidden until one is touched.';
    setText(el.status, status);
    el.status.classList.toggle('live', w.connected);
    el.live.hidden = w.pads.length === 0;

    // The picker is rebuilt only when what is plugged in changes, or it
    // would close itself under the driver's pointer every frame.
    const key = `${w.devices.map((d) => d.id).join('|')}→${w.deviceId}`;
    if (key !== this._deviceKey) {
      this._deviceKey = key;
      el.device.innerHTML = '';
      if (!w.deviceId) el.device.append(new Option('choose a controller…', ''));
      for (const d of w.devices) el.device.append(new Option(d.wheel ? d.name : `${d.name} (not a wheel)`, d.id));
      el.device.value = w.deviceId ?? '';
    }

    const m = w.mapping;
    for (const node of [el.rotation, el.measure, el.map, el.centre, el.reset]) node.disabled = !m;
    if (!m) return;
    if (document.activeElement !== el.rotation) el.rotation.value = String(m.rotation);
    el.rotation.classList.toggle('assumed', !w.rotationKnown);
    setText(el.rotationNote, ROTATION_NOTE[m.rotationFrom] ?? ROTATION_NOTE.default);
    el.rotationNote.classList.toggle('assumed', !w.rotationKnown);

    el.force.disabled = el.strength.disabled = !w.drivable;
    setText(el.strengthValue, `${Math.round(this.settings.get('wheelStrength') * 100)}%`);

    const moza = w.native?.moza;
    el.base.hidden = !w.baseConnected;
    if (w.baseConnected) {
      const v = moza.values;
      setText(el.baseRotation, v.rotation ? `${v.rotation}°` : '—');
      setText(el.baseFfb, v['ffb-strength'] != null ? `${Math.round(v['ffb-strength'])}%` : '—');
      setText(el.baseTemp, v['mcu-temp'] != null
        ? `${v['mcu-temp'].toFixed(0)}°C board${v['motor-temp'] != null ? ` · ${v['motor-temp'].toFixed(0)}°C motor` : ''}` : '—');
    }
    const busy = moza?.state === 'busy' && /Vendor: 346e/i.test(w.deviceId ?? '');
    el.baseNote.hidden = !busy;
    if (busy) {
      setText(el.baseNote, `${moza.holder ?? 'Another program'} has the base's serial port open, so its settings cannot be read from here. Steering and force feedback still work. Close ${moza.holder ?? 'it'} to manage the base from Wheelhouse.`);
    }

    // The rim, centred, as a fraction of its own range so full lock fills it.
    const half = m.rotation / 2;
    const f = Math.max(-1, Math.min(1, w.degrees / half));
    el.steerBar.style.left = f >= 0 ? '50%' : `${50 + f * 50}%`;
    el.steerBar.style.width = `${Math.abs(f) * 50}%`;
    setText(el.steerValue, `${w.degrees >= 0 ? '+' : '−'}${Math.abs(w.degrees).toFixed(0)}°`);


    const wizard = w.wizard;
    el.prompt.hidden = !wizard;
    el.skip.hidden = el.cancel.hidden = !wizard;
    el.map.hidden = el.centre.hidden = el.reset.hidden = !!wizard;
    if (wizard) {
      const n = Math.min(wizard.step + 1, wizard.steps.length);
      setText(el.prompt, wizard.listening
        ? `${n}/${wizard.steps.length} · ${wizard.current.prompt}`
        : 'Got it — let go of everything…');
    }
  }
}

const ROTATION_NOTE = {
  default: 'A guess — this wheel has not said how far it turns. If the rig turns further than the rim, Measure it, or type in what the wheel is set to.',
  base: 'Read from the base itself.',
  measured: 'Measured from a half turn of the rim.',
  set: 'As typed in. It has to match what the wheel itself is set to.',
};

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
