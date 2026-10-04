/**
 * The CAR panel: what the pedals are actually doing to the car.
 *
 * The pedals no longer map straight onto speed — the throttle goes through a
 * torque map and the brakes through hydraulics, the tyres can spin or lock,
 * and carbon brakes only bite hot. This shows each of those, so a car that
 * will not pull or will not stop says why.
 */
export class CarPanel {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      speed: $('carSpeed'), gear: $('carGear'), g: $('carG'),
      torque: $('carTorque'), brake: $('carBrake'), discs: $('carDiscs'),
      spin: $('carSpin'), lock: $('carLock'),
    };
    this._g = 0;
  }

  /** @param {object} t the car's telemetry */
  update(t) {
    const { el } = this;
    setText(el.speed, String(Math.round(t.speed)));
    setText(el.gear, t.gearLabel ?? String(t.gear));
    el.gear.classList.toggle('reverse', t.gear === -1);
    // Smoothed a little, or it flickers on the frame-to-frame noise.
    this._g += ((t.accelG ?? 0) - this._g) * 0.2;
    setText(el.g, `${this._g >= 0 ? '+' : '−'}${Math.abs(this._g).toFixed(2)}`);
    setText(el.torque, `${Math.round((t.torque ?? 0) * 100)}%`);
    setText(el.brake, `${Math.round(t.brakeBar ?? 0)} bar`);
    const temp = t.brakeTemp ?? 0;
    setText(el.discs, `${Math.round(temp)} °C`);
    const tone = temp < 350 ? 'cold' : temp > 1000 ? 'hot' : 'ok';
    if (el.discs.dataset.tone !== tone) el.discs.dataset.tone = tone;
    flag(el.spin, !!t.wheelspin);
    flag(el.lock, !!t.lockup);
  }
}

function flag(node, on) {
  const v = String(on);
  if (node.dataset.on !== v) node.dataset.on = v;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
