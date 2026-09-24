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
/** How much of a gear's top speed the limiter tapers power over. */
const LIMITER_BAND = 0.08;
/** How hard an over-revving engine drags the car back, per km/h of overrun. */
const OVER_REV = 2.2;
/** How far past a gear's top speed a driver may drop into it. */
const OVER_REV_ALLOWED = 1.06;
/** The fraction of a gear's top speed at which the automatic box takes the next one. */
const UPSHIFT_AT = 0.94;
/**
 * And where it drops back, as a fraction of the gear below's top speed.
 *
 * The gap between the two is what stops the box hunting. Upshifting at 0.96
 * of a gear lands the car below the next gear's band, so a downshift rule
 * written against that band fires immediately and the box oscillates — six to
 * seven and back, twenty times in a minute, which it did.
 */
const DOWNSHIFT_AT = 0.88;

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

    /**
     * What the gear the driver is in can actually pull to.
     *
     * This is what a gear ratio *is*, and it was missing: the engine kept
     * making power however far past a gear's top speed the car went, so first
     * gear held at full throttle reached 286 km/h against a ratio good for
     * 78. Nothing in the model objected, because the only thing that had ever
     * stopped it was the automatic box upshifting — and that stands down for
     * two and a half seconds after a paddle pull, which is exactly when a
     * driver is holding a gear on purpose.
     */
    const geared = RATIOS[this.gear - 1].top;

    // Cornering scrubs speed: the more lock, the lower the ceiling. The gear
    // caps it too, and whichever bites first is the one that matters.
    const ceiling = Math.min(330 * (1 - 0.66 * Math.pow(load, 1.25)), geared);

    if (pedals) {
      this.throttle = clamp(pedals.throttle ?? 0, 0, 1);
      this.brake = clamp(pedals.brake ?? 0, 0, 1);
      this.driven = true;

      // Power falls away with speed — a car gains far less at 300 than at 100 —
      // and the gear the driver is in sets how much of it reaches the road.
      const reach = this.speed / Math.max(1, geared);
      // Short gears pull harder. Eighth at 40 km/h bogs, first at its limiter
      // has nothing left, and both of those should be felt.
      const pull = 1.35 - 0.5 * clamp(reach, 0, 1);
      // Traction, which is what actually limits a car off the line. An F1
      // car cannot use its power below about 80 km/h because it has not yet
      // made the downforce to put it down — so this ramps in with speed
      // rather than being available from rest.
      const traction = 0.42 + 0.58 * clamp(this.speed / 80, 0, 1);
      // The limiter. Power tapers away over the last few percent of the gear
      // and is gone at its top speed, which is the whole point of a ratio:
      // the engine cannot turn faster, so the car cannot go faster, whatever
      // the right foot is asking for.
      const limiter = clamp((1 - reach) / LIMITER_BAND, 0, 1);
      const power = ACCEL_MAX * this.throttle * pull * traction * limiter
        * Math.max(0, 1 - this.speed / POWER_FADE);

      // Past what the gear will hold — rolling into a corner and grabbing a
      // low gear — the wheels are driving the engine rather than the other
      // way round, and it holds the car back hard.
      const overRev = Math.max(0, this.speed - geared) * OVER_REV;

      // Brakes outrank the engine by a long way, as carbon discs do.
      const braking = BRAKE_MAX * this.brake;

      // Drag, plus the scrub that cornering costs. Above the ceiling the tyres
      // are past what the corner will take and the car washes off speed
      // whatever the driver's right foot is asking for.
      const drag = DRAG_K * this.speed * this.speed + 1.5;
      const over = Math.max(0, this.speed - ceiling);
      const scrub = over * 2.6;

      this.speed += (power - braking - drag - scrub - overRev) * dt;
      this.speed = clamp(this.speed, 0, 360);
    } else {
      this.throttle = 0;
      this.brake = 0;
      this.driven = false;
      // `ceiling` already carries the gear's limit, so the car it drives
      // itself into is one the gearbox could actually have got there in.
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
      // Upshift on reaching the limiter, measured against this gear's own top
      // speed rather than against how far through the band the car is. Those
      // were the same thing until the limiter arrived; now power tapers away
      // as the gear runs out, so the car settles just short of its top and a
      // threshold expressed as a fraction of the band was never crossed. The
      // box stuck in second at 117 km/h with the throttle flat to the floor.
      if (this.speed >= band.top * UPSHIFT_AT && this.gear < RATIOS.length) {
        this.gear++; this._shiftCooldown = 0.16;
      } else if (this.gear > 1 && this.speed < RATIOS[this.gear - 2].top * DOWNSHIFT_AT) {
        this.gear--; this._shiftCooldown = 0.16;
      }
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
   *
   * A downshift into a gear that cannot hold the speed the car is already
   * doing is refused, as a real gearbox refuses it. Allowing it would let a
   * driver drop from eighth at 300 km/h into first, which in a car means a
   * destroyed engine and in a model means an absurd number — the sim would
   * have had to invent several hundred km/h of engine braking to cope with
   * something that should never have been permitted.
   *
   * A little over the gear's top is allowed, because that is a real thing a
   * driver does on the way into a corner, and the over-rev drag handles it.
   *
   * @param {-1|1} direction
   * @returns {boolean} whether a gear was actually available that way
   */
  shift(direction) {
    const next = clamp(this.gear + direction, 1, RATIOS.length);
    if (next === this.gear) return false;
    if (direction < 0 && this.speed > RATIOS[next - 1].top * OVER_REV_ALLOWED) return false;
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
