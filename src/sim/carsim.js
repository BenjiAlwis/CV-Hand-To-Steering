/**
 * A light vehicle model, just enough to make the wheel's instruments honest.
 *
 * It is not a physics engine — it exists so the LCD and the rev lights
 * respond to what the driver's hands are doing. Steering scrubs speed the way
 * it really does, the gearbox shifts on rpm, and the lap clock and delta run
 * off the resulting pace.
 */
const RATIOS = [
  { gear: 1, top: 78 }, { gear: 2, top: 118 }, { gear: 3, top: 158 },
  { gear: 4, top: 196 }, { gear: 5, top: 232 }, { gear: 6, top: 267 },
  { gear: 7, top: 298 }, { gear: 8, top: 330 },
];

const RPM_MAX = 15000;
const RPM_IDLE = 4200;

export class CarSim {
  constructor() {
    this.speed = 0;          // km/h
    this.gear = 1;
    this.rpm = RPM_IDLE;
    this.lapTime = 0;
    this.lap = 1;
    this.delta = 0;
    this.fuel = 48.6;
    this.ers = 0.72;
    this.brakeBias = 56.5;
    this.diff = 9;
    this.mix = 3;
    this.flag = 'none';
    this._flagTimer = 14 + Math.random() * 25;
    this._deltaDrift = 0;
    this._shiftCooldown = 0;
    this._manualHold = 0;
    /** +1 or -1 on the frame a shift lands, for the overlay to flash. */
    this.lastShift = 0;
  }

  /**
   * @param {number} dt
   * @param {number} steer  −1 … +1
   */
  update(dt, steer) {
    const load = Math.min(1, Math.abs(steer));

    // Cornering scrubs speed: the more lock, the lower the ceiling.
    const ceiling = 330 * (1 - 0.66 * Math.pow(load, 1.25));
    const gap = ceiling - this.speed;
    // Power-limited acceleration, but braking is far stronger.
    const rate = gap > 0 ? 34 * (1 - this.speed / 360) : 96;
    this.speed += Math.sign(gap) * Math.min(Math.abs(gap), Math.abs(rate) * dt) ;
    this.speed = Math.max(0, this.speed);

    // Gearbox.
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    this._manualHold = Math.max(0, this._manualHold - dt);
    this.lastShift = 0;
    const band = RATIOS[this.gear - 1];
    const lower = this.gear > 1 ? RATIOS[this.gear - 2].top : 0;
    const spanIn = Math.max(1, band.top - lower);
    const through = (this.speed - lower) / spanIn;

    // The automatic box stands down for a moment after a paddle pull,
    // otherwise it would immediately undo the gear the driver just chose.
    if (this._shiftCooldown === 0 && this._manualHold === 0) {
      if (through > 0.99 && this.gear < RATIOS.length) { this.gear++; this._shiftCooldown = 0.16; }
      else if (through < -0.04 && this.gear > 1) { this.gear--; this._shiftCooldown = 0.16; }
    }

    const b = RATIOS[this.gear - 1];
    const lo = this.gear > 1 ? RATIOS[this.gear - 2].top : 0;
    const frac = clamp((this.speed - lo) / Math.max(1, b.top - lo), 0, 1);
    const targetRpm = RPM_IDLE + (RPM_MAX - RPM_IDLE) * frac;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 9);

    // Lap clock and a delta that responds to how tidy the driving is.
    this.lapTime += dt;
    this._deltaDrift += (Math.random() - 0.5) * dt * 0.28;
    this._deltaDrift = clamp(this._deltaDrift, -0.5, 0.5);
    this.delta = clamp(this._deltaDrift + (load - 0.28) * 0.9, -1.8, 2.4);

    if (this.lapTime > 82) { this.lapTime = 0; this.lap++; this._deltaDrift *= 0.4; }

    this.fuel = Math.max(0, this.fuel - dt * 0.021);

    // ERS harvests under load and deploys on the straights.
    const deploy = this.speed > 210 && load < 0.25;
    this.ers = clamp(this.ers + (deploy ? -0.055 : 0.028) * dt, 0, 1);

    // Occasional marshalling flag, so the flag LEDs have something to do.
    this._flagTimer -= dt;
    if (this._flagTimer <= 0) {
      const roll = Math.random();
      this.flag = this.flag === 'none'
        ? (roll < 0.5 ? 'yellow' : roll < 0.85 ? 'blue' : 'red')
        : 'none';
      this._flagTimer = this.flag === 'none' ? 16 + Math.random() * 28 : 3.5 + Math.random() * 4;
    }

    return this.telemetry;
  }

  /**
   * A pull of a gear flap.
   * @param {-1|1} direction
   * @returns {boolean} whether a gear was actually available that way
   */
  shift(direction) {
    const next = clamp(this.gear + direction, 1, RATIOS.length);
    if (next === this.gear) return false;
    this.gear = next;
    this.lastShift = direction;
    this._shiftCooldown = 0.12;
    this._manualHold = 2.5;
    return true;
  }

  get telemetry() {
    return {
      gear: this.gear,
      speed: this.speed,
      rpm: this.rpm,
      rpmMax: RPM_MAX,
      rpmFraction: clamp((this.rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE), 0, 1),
      lapTime: this.lapTime,
      lap: this.lap,
      delta: this.delta,
      fuel: this.fuel,
      ers: this.ers,
      brakeBias: this.brakeBias,
      diff: this.diff,
      mix: this.mix,
      flag: this.flag,
      lastShift: this.lastShift,
      manual: this._manualHold > 0,
    };
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
