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

/**
 * km/h per second at full throttle in the meat of a gear, and under braking.
 * Braking dwarfs power because it does in the car: carbon discs pull about
 * 5g, which is roughly 175 km/h of speed shed every second.
 */
const ACCEL_MAX = 70;
const BRAKE_MAX = 190;
/** Where power runs out, and what the air costs. Together these set top speed. */
const POWER_FADE = 380;
const DRAG_K = 0.00012;

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
    /** What the feet are asking for, 0…1, and whether they are asking at all. */
    this.throttle = 0;
    this.brake = 0;
    this.driven = false;
  }

  /**
   * @param {number} dt
   * @param {number} steer  −1 … +1
   * @param {{throttle: number, brake: number}} [pedals]
   *   When the foot camera is tracking, the car is driven. When it is not,
   *   pass nothing: the car drives itself as it always did, so the rig still
   *   works on one camera and the instruments still have something to show.
   */
  update(dt, steer, pedals = null) {
    const load = Math.min(1, Math.abs(steer));

    // Cornering scrubs speed: the more lock, the lower the ceiling.
    const ceiling = 330 * (1 - 0.66 * Math.pow(load, 1.25));

    if (pedals) {
      this.throttle = clamp(pedals.throttle ?? 0, 0, 1);
      this.brake = clamp(pedals.brake ?? 0, 0, 1);
      this.driven = true;

      // Power falls away with speed — a car gains far less at 300 than at 100 —
      // and the gear the driver is in sets how much of it reaches the road.
      const band = RATIOS[this.gear - 1];
      const reach = this.speed / Math.max(1, band.top);
      // Short gears pull harder. Eighth at 40 km/h bogs, first at its limiter
      // has nothing left, and both of those should be felt.
      const pull = 1.35 - 0.5 * clamp(reach, 0, 1.4);
      // Traction, which is what actually limits a car off the line. An F1
      // car cannot use its power below about 80 km/h because it has not yet
      // made the downforce to put it down — so this ramps in with speed
      // rather than being available from rest.
      const traction = 0.42 + 0.58 * clamp(this.speed / 80, 0, 1);
      const power = ACCEL_MAX * this.throttle * pull * traction
        * Math.max(0, 1 - this.speed / POWER_FADE);

      // Brakes outrank the engine by a long way, as carbon discs do.
      const braking = BRAKE_MAX * this.brake;

      // Drag, plus the scrub that cornering costs. Above the ceiling the tyres
      // are past what the corner will take and the car washes off speed
      // whatever the driver's right foot is asking for.
      const drag = DRAG_K * this.speed * this.speed + 1.5;
      const over = Math.max(0, this.speed - ceiling);
      const scrub = over * 2.6;

      this.speed += (power - braking - drag - scrub) * dt;
      this.speed = clamp(this.speed, 0, 360);
    } else {
      this.throttle = 0;
      this.brake = 0;
      this.driven = false;
      const gap = ceiling - this.speed;
      // Power-limited acceleration, but braking is far stronger.
      const rate = gap > 0 ? 34 * (1 - this.speed / 360) : 96;
      this.speed += Math.sign(gap) * Math.min(Math.abs(gap), Math.abs(rate) * dt) ;
      this.speed = Math.max(0, this.speed);
    }

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
      throttle: this.throttle,
      brake: this.brake,
      driven: this.driven,
    };
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
