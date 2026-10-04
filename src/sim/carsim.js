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
 * The longitudinal model is physical — forces on a mass — with its numbers
 * taken from published figures for the 2022–2025 cars where they exist, and
 * estimated where they do not:
 *
 *   mass        798 kg minimum with driver, plus an average fuel load
 *   drag        CdA about 1.2–1.3 m² (Cd ≈ 0.85)
 *   downforce   equal to the car's weight at about 150 km/h, 3–4× at top speed
 *   rolling     slick-tyre Crr about 0.015, on the weight *plus* downforce
 *   power       750 kW peak; 650 kW is the average that reproduces published
 *               standing starts (0–100 in 2.6 s, 0–200 in 4.8 s, 0–300 in
 *               10.5 s) — full deployment is not sustained, and the model has
 *               no shift times
 *   grip        about 1.05 g off the line, rising with downforce
 *
 * The point of doing it this way is lift-off. Without the brake an F1 car
 * slows at around 1 g from top speed on drag alone, because drag grows with
 * the square of speed; at 100 km/h the same car barely notices the air and
 * slows on engine braking instead. The old fitted curve gave 0.35 g at
 * 300 km/h — a car that coasted like a road car.
 */
const G = 9.81;
const MASS = 850;          // kg
const AIR = 1.225;         // kg/m³
const CDA = 1.3;           // m²
const CRR = 0.015;
const POWER = 650e3;       // W, effective
/**
 * The power curve, by how far through a gear's revs the engine is: full
 * power from `FULL_POWER_AT` up (the fuel-flow limit flattens it), tapering
 * to `POWER_FLOOR` at idle, with torque capped at `TORQUE_PEAK` times the
 * torque at full power.
 */
const FULL_POWER_AT = 0.7;
const POWER_FLOOR = 0.15;
const TORQUE_PEAK = 1.45;
/** Rear-tyre traction off the line, in g, before downforce adds to it. */
const GRIP_G = 1.05;
/** Downforce equals weight at this speed (km/h), rises with its square, and is capped. */
const DOWNFORCE_REF = 150;
const DOWNFORCE_MAX = 4;
/**
 * Engine braking: the closed-throttle engine and the MGU-K harvesting on the
 * overrun. No published figure exists, so it is estimated: about 60 kW
 * absorbed at full revs. Power absorbed in proportion to revs works out as a
 * constant force per gear, stronger the lower the gear — and capped, since
 * the rear tyres can only take so much. It fades as revs fall toward idle,
 * where the clutch opens to stop the engine stalling.
 */
const ENGINE_BRAKE_POWER = 60e3;  // W at full revs
const ENGINE_BRAKE_MAX_G = 0.25;
/**
 * Tyre grip for braking, on all four tyres. Slicks reach a friction
 * coefficient of about 1.9 lightly loaded and lose it as load rises — load
 * sensitivity — so the downforce that piles load on at speed buys less grip
 * than its size suggests. With these figures the tyres take about 1.9 g at
 * a crawl, 2.4 g at 100 km/h, 3.6 g at 200 and 4.5 g at 300; add drag and
 * engine braking and that is the 5 g-plus peak F1 is known for, falling as
 * the car slows.
 */
const MU_LOW = 1.9;
const MU_LOAD = 0.27;
/**
 * What a sliding tyre keeps of its peak grip: spinning under power, or
 * locked under braking. Published figures put a locked slick 10–40% below
 * its peak.
 */
const SPIN_KEEP = 0.75;
const LOCK_KEEP = 0.7;
/** How far below the limit a slide has to be brought back before the tyre bites again. */
const RECOVER = 0.85;

/**
 * Brakes. Full pedal on hot brakes asks for about 4.4 g of tyre force —
 * roughly what the tyres take at 300 km/h. That is the point of an F1 brake
 * pedal: full pressure is right at top speed and far too much by 150 km/h,
 * so without ABS the driver has to come off the pedal as the car slows or
 * lock the wheels.
 */
const BRAKE_SYSTEM_G = 4.4;
/** Line pressure at full pedal, bar — for the overlay; F1 peaks are 80–100. */
const BRAKE_BAR_MAX = 100;
/**
 * Pedal to wheel. Hydraulics and a drive-by-wire throttle are quick but not
 * instant; with the MGU-H spooling the turbo there is no lag to speak of.
 * Estimated, since neither is published.
 */
const THROTTLE_TAU = 0.05;   // s
const BRAKE_TAU = 0.04;      // s
/**
 * Throttle pedal map: pedal travel to torque request. Race maps are
 * progressive, so the first part of the travel is fine control where
 * traction is marginal. The exponent is an estimate.
 */
const THROTTLE_MAP = 1.4;

/**
 * Carbon–carbon brakes only work hot: friction is a fraction of its best
 * below about 350 °C, full from 400 to 1000, and fades above. The discs and
 * pads are about 8 kJ/K of carbon between them (estimated); they heat with the energy
 * braking puts in and cool in the airflow, faster the faster the car goes —
 * sized, as teams size their ducts, to hold them around 400–550 °C between
 * stops.
 * The car starts with them at working temperature, as after an out-lap.
 */
const BRAKE_START_TEMP = 450;   // °C
const AMBIENT = 30;             // °C
const BRAKE_HEAT_CAP = 8e3;     // J/K
const BRAKE_COOL = 0.008;       // 1/s, stationary
const BRAKE_COOL_SPEED = 0.0001; // 1/s per km/h
/** How much of a gear's top speed the limiter tapers power over. */
const LIMITER_BAND = 0.03;
/** How hard an over-revving engine drags the car back, per km/h of overrun. */
const OVER_REV = 2.2;
/** How far past a gear's top speed a driver may drop into it. */
const OVER_REV_ALLOWED = 1.06;
/**
 * Neutral and reverse. F1 cars select both with a button on the wheel, not
 * the paddles, so neither can be engaged by accident at speed: neutral with
 * an N button, reverse with a long press of it or an R button. The rules
 * require every car to have one. Reverse is a slow gear through an
 * intermediate wheel; no ratio is published, so its top speed is estimated.
 * It only engages with the car all but stopped — `CREEP` — as reverse gears
 * have no synchromesh.
 */
export const NEUTRAL = 0;
export const REVERSE = -1;
const REVERSE_TOP = 60;   // km/h
const CREEP = 3;          // km/h
/** How long a remembered downshift waits for the speed to allow it, in seconds. */
const QUEUE_TIMEOUT = 3;
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
  /**
   * @param {object} [o]
   * @param {number} [o.gear]  the gear it starts in: 1–8, NEUTRAL or REVERSE.
   *   The rig starts parked in neutral; tests mostly start in first.
   */
  constructor({ gear = 1 } = {}) {
    this.speed = 0;          // km/h, always ≥ 0 — which way is `direction`
    /** +1 rolling forward, −1 rolling backward. Meaningless at rest. */
    this.direction = 1;
    this.gear = gear;
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
    /** What reaches the car this frame, 0…1 — the driver's feet plus any aid. */
    this.throttle = 0;
    this.brake = 0;
    /** Whether a driver's pedals (real ones or the foot camera) are in use. */
    this.driven = false;
    /**
     * Driving aids, all off unless switched on. With none of them on and no
     * pedals, the car sits still: it only moves when it is driven.
     *
     *   gears     the automatic gearbox
     *   throttle  accelerates toward whatever speed the corner allows
     *   brake     brakes when the car is going faster than the corner allows
     */
    this.assists = { gears: false, throttle: false, brake: false, queueDown: false,
      // Both banned in F1, and both available: without them, noisy pedals —
      // a foot camera, say — spin and lock the tyres constantly.
      traction: false, abs: false };
    /** What lifting off costs at the current speed, in g, by source. */
    this.resistance = { aero: 0, rolling: 0, engine: 0 };
    /**
     * What actually reaches the car, after the pedal maps and the hydraulics:
     * torque as a fraction of what the engine can give, and line pressure as
     * a fraction of full.
     */
    this.torque = 0;
    this.pressure = 0;
    /** Rear tyres spinning under power, or tyres locked under braking. */
    this.wheelspin = false;
    this.lockup = false;
    /** Brake disc temperature, °C. */
    this.brakeTemp = BRAKE_START_TEMP;
    /** What the tyres could take right now, in g: braking on four, driving on the rears. */
    this.grip = { brake: 0, drive: 0 };
    /** The car's actual acceleration last frame, in g — negative is slowing. */
    this.accelG = 0;
    /**
     * Why the last shift request was turned down, or null: `{direction, gear,
     * reason}`. A refused downshift is the gearbox protecting the engine, as a
     * real one does, and the driver needs to be told rather than left to
     * think the paddle is broken.
     */
    this.refusal = null;
    /**
     * Downshifts asked for while the car was too fast for them, waiting for
     * the speed to come down — only with the `queueDown` aid on. Each refused
     * pull is one more gear. They lapse after `QUEUE_TIMEOUT` seconds, so a
     * driver who aborts the braking zone does not get a gear later on.
     */
    this.queuedDown = 0;
    this._queueAge = 0;
    /** -1 on the frame a queued downshift lands, for the overlay. */
    this.queuedShift = 0;
  }

  /**
   * @param {number} dt
   * @param {number} steer  −1 … +1
   * @param {{throttle: number, brake: number}} [pedals]
   *   The driver's feet, from real pedals or the foot camera, or nothing when
   *   neither is in use. Without them the car only moves if an aid moves it.
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
    const inGear = this.gear >= 1;
    const geared = inGear ? RATIOS[this.gear - 1].top : this.gear === REVERSE ? REVERSE_TOP : RATIOS[0].top;
    /** Which way the gear drives the car: forward, backward, or not at all in neutral. */
    const gearSign = inGear ? 1 : this.gear === REVERSE ? -1 : 0;
    // The engine is only turned by the wheels when the car is rolling the
    // way the gear drives it. Rolling back in first, or forward in reverse,
    // the clutch slips and the engine sits near idle.
    const coupled = gearSign !== 0 && (this.speed < CREEP || this.direction === gearSign);

    // Cornering scrubs speed: the more lock, the lower the corner allows.
    // With the automatic box on the gear is changed to suit, so only the
    // corner sets the pace an aid aims for; with it off, the gear the driver
    // chose caps it too.
    const corner = 330 * (1 - 0.66 * Math.pow(load, 1.25));
    const ceiling = Math.min(corner, geared);

    const foot = {
      throttle: clamp(pedals?.throttle ?? 0, 0, 1),
      brake: clamp(pedals?.brake ?? 0, 0, 1),
    };
    this.driven = !!pedals;

    // ── the state of the tyres at this speed ────────────────────────────
    const v = this.speed / 3.6;
    const reach = coupled ? this.speed / Math.max(1, geared) : 0;
    // Downforce, as a multiple of the car's weight. It loads the tyres: more
    // grip, but with diminishing returns, and more rolling resistance.
    const downforce = Math.min(DOWNFORCE_MAX, (this.speed / DOWNFORCE_REF) ** 2);
    const loadFactor = 1 + downforce;
    const brakeGrip = (MU_LOW / (1 + MU_LOAD * downforce)) * loadFactor;
    const driveGrip = GRIP_G * (1 + 0.5 * downforce);
    this.grip = { brake: brakeGrip, drive: driveGrip };

    // What the engine can push with in this gear at these revs, in g. F1
    // engines are fuel-flow limited above about 10,500 rpm, so power is flat
    // across the top of the rev range and falls away below it; torque peaks
    // lower down and is capped there. The force at the wheels is torque
    // times the gear's ratio, so a low gear pushes far harder — harder than
    // the rear tyres can take, which is why these cars are traction-limited
    // in the low gears.
    const powerShare = clamp(POWER_FLOOR + (1 - POWER_FLOOR) * (reach / FULL_POWER_AT), 0, 1);
    const torqueCurve = Math.min(TORQUE_PEAK, powerShare / Math.max(reach, 0.05));
    // The limiter. Power tapers away over the last few percent of the gear
    // and is gone at its top speed, which is the whole point of a ratio:
    // the engine cannot turn faster, so the car cannot go faster, whatever
    // the right foot is asking for.
    const limiter = clamp((1 - reach) / LIMITER_BAND, 0, 1);
    const engineG = gearSign === 0 ? 0 : (POWER / (MASS * (geared / 3.6))) / G * torqueCurve * limiter;

    // Engine braking, which goes through the rear tyres like the brakes do.
    const revs = clamp((reach - 0.2) / 0.15, 0, 1);
    // None in neutral, or with the clutch slipping: nothing connects the
    // engine's drag to the wheels.
    const engineBrakeFull = !coupled ? 0
      : revs * Math.min(ENGINE_BRAKE_MAX_G, ENGINE_BRAKE_POWER / (MASS * (geared / 3.6)) / G);
    const brakeFriction = brakeTempFactor(this.brakeTemp);

    // ── pedals ──────────────────────────────────────────────────────────
    // The aids work the same pedals a driver would, and never against one:
    // a driver on the brake gets no help on the throttle, and the throttle
    // aid backs off whenever the brake aid is working. An aid is a good
    // driver, too: it never asks for more than the tyres will take.
    const aim = this.assists.gears ? corner : ceiling;
    const brakeForGrip = brakeFriction > 0 ? clamp((brakeGrip * 0.95) / (BRAKE_SYSTEM_G * brakeFriction), 0, 1) : 0;
    const throttleForGrip = engineG > 0 ? clamp((driveGrip * 0.95) / engineG, 0, 1) ** (1 / THROTTLE_MAP) : 1;
    const assistBrake = this.assists.brake ? clamp((this.speed - aim) / 15, 0, 1) * brakeForGrip : 0;
    // Never in neutral or reverse: driving off, either way, is the driver's call.
    const assistThrottle = this.assists.throttle && inGear && foot.brake < 0.05 && assistBrake === 0
      ? clamp((aim - this.speed) / 20, 0, 1) * throttleForGrip : 0;
    this.throttle = Math.max(foot.throttle, assistThrottle);
    this.brake = Math.max(foot.brake, assistBrake);

    // Pedal to wheel: the throttle through its map, the brake straight to
    // line pressure, each arriving a moment later.
    this.torque += (this.throttle ** THROTTLE_MAP - this.torque) * (1 - Math.exp(-dt / THROTTLE_TAU));
    this.pressure += (this.brake - this.pressure) * (1 - Math.exp(-dt / BRAKE_TAU));

    // ── driving force, and wheelspin ────────────────────────────────────
    let driveG = this.torque * engineG;
    if (this.assists.traction) driveG = Math.min(driveG, driveGrip * 0.97);
    // Ask the rear tyres for more than they have and they spin; once spinning
    // they keep less grip than they had, and stay spinning until the driver
    // comes back off the throttle well below the limit.
    if (driveG > driveGrip) this.wheelspin = true;
    else if (driveG < driveGrip * RECOVER) this.wheelspin = false;
    if (this.wheelspin) driveG = Math.min(driveG, driveGrip * SPIN_KEEP);

    // ── braking force, and lock-up ──────────────────────────────────────
    // Only on the overrun: the torque map crosses from drag to drive within
    // the first few percent of the pedal, so any real throttle cancels it.
    const engineBrakeG = clamp(1 - this.torque / 0.1, 0, 1) * engineBrakeFull;
    const pedalBrakeG = this.pressure * BRAKE_SYSTEM_G * brakeFriction;
    let tyreBrakeG = pedalBrakeG + engineBrakeG;
    if (this.assists.abs) tyreBrakeG = Math.min(tyreBrakeG, brakeGrip * 0.97);
    // The same with the brakes: past the limit the tyres lock, a locked tyre
    // stops worse than one at the limit, and it stays locked until the pedal
    // comes back. This is why F1 drivers ease off as they slow — downforce
    // and with it grip fall away, and the pressure that was right at 300 is
    // far too much at 150.
    if (this.speed < 3) this.lockup = false;
    else if (tyreBrakeG > brakeGrip) this.lockup = true;
    else if (tyreBrakeG < brakeGrip * RECOVER) this.lockup = false;
    if (this.lockup) tyreBrakeG = Math.min(tyreBrakeG, brakeGrip * LOCK_KEEP);

    // ── what slows it whatever the pedals do ────────────────────────────
    // Drag dominates at speed, engine braking at low speed, rolling
    // resistance is small throughout.
    const aeroG = (0.5 * AIR * CDA * v * v) / MASS / G;
    const rollingG = v > 0.1 ? CRR * loadFactor : 0;

    // Past what the gear will hold — rolling into a corner and grabbing a
    // low gear — the wheels are driving the engine rather than the other
    // way round, and it holds the car back hard.
    const overRev = coupled ? Math.max(0, this.speed - geared) * OVER_REV : 0;

    // Above what the corner will take the tyres wash off speed whatever the
    // driver's right foot is asking for.
    const over = Math.max(0, this.speed - corner);
    const scrub = over * 2.6;

    /** What lifting off is costing right now, in g — for the overlay and the tests. */
    this.resistance = { aero: aeroG, rolling: rollingG, engine: engineBrakeFull };

    // Worked as a signed velocity, so the car can roll either way. The drive
    // pushes the way the gear points; everything else — brakes, tyres, air —
    // opposes the motion, and can bring the car to rest but never push it
    // backwards. Only the engine can do that.
    const push = driveG * gearSign;
    const resist = tyreBrakeG + aeroG + rollingG;
    const k = G * 3.6 * dt;
    const before = this.speed * this.direction;
    let after;
    if (this.speed < 1e-6) {
      // At rest: it moves only if the engine beats whatever holds it.
      const net = Math.abs(push) - resist;
      after = net > 0 ? Math.sign(push) * net * k : 0;
    } else {
      after = before + (push - Math.sign(before) * resist) * k - Math.sign(before) * (scrub + overRev) * dt;
      // Resistance stops the car; it does not reverse it.
      if (Math.sign(after) !== Math.sign(before) && !(Math.sign(push) === Math.sign(after) && Math.abs(push) > resist)) {
        after = 0;
      }
    }
    after = clamp(after, -REVERSE_TOP * 1.2, 360);
    if (after !== 0) this.direction = Math.sign(after);
    this.speed = Math.abs(after);
    // Along the car, so braking while reversing still reads as slowing.
    this.accelG = (((after - before) * (this.direction || 1)) / Math.max(dt, 1e-6)) / 3.6 / G;

    // Brake heat: the share of the tyres' braking that the discs did, as
    // power into the carbon, against cooling in the airflow.
    const discShare = tyreBrakeG > 0 ? pedalBrakeG / (pedalBrakeG + engineBrakeG) : 0;
    const heat = discShare * tyreBrakeG * G * MASS * v / BRAKE_HEAT_CAP;
    const cool = (this.brakeTemp - AMBIENT) * (BRAKE_COOL + BRAKE_COOL_SPEED * this.speed);
    this.brakeTemp += (heat - cool) * dt;

    // Gearbox.
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    this._manualHold = Math.max(0, this._manualHold - dt);
    this.lastShift = 0;
    this.queuedShift = 0;

    // Remembered downshifts land as soon as the speed allows each one — the
    // same check `shift` makes, so a queued gear is never one the box would
    // have refused.
    if (this.queuedDown > 0) {
      this._queueAge += dt;
      if (!this.assists.queueDown || this._queueAge > QUEUE_TIMEOUT || this.gear <= 1) {
        this.queuedDown = 0;
      } else if (this.speed <= RATIOS[this.gear - 2].top * OVER_REV_ALLOWED) {
        this.gear--;
        this.queuedDown--;
        this._queueAge = 0;
        this.lastShift = -1;
        this.queuedShift = -1;
        this._shiftCooldown = 0.12;
        this._manualHold = 2.5;
      }
    }
    if (inGear) {
      const band = RATIOS[this.gear - 1];

      // The automatic box, when it is switched on. It stands down for a moment
      // after a paddle pull, otherwise it would immediately undo the gear the
      // driver just chose. Off, the gear changes only when the driver changes it.
      if (this.assists.gears && this._shiftCooldown === 0 && this._manualHold === 0) {
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
    } else if (this.gear === NEUTRAL && this.assists.gears && foot.throttle > 0.1
               && !(this.direction < 0 && this.speed > CREEP)) {
      // An automatic box takes the car out of neutral when the driver asks to
      // go — as a road car's would in drive. Never into reverse.
      this.gear = this.lowestGearFor(this.speed);
      this.lastShift = 1;
    }

    // Revs. In gear they follow the road speed; in neutral the throttle spins
    // the engine freely; with the clutch slipping it sits near idle.
    let targetRpm;
    if (this.gear >= 1 && coupled) {
      const b = RATIOS[this.gear - 1];
      const lo = this.gear > 1 ? RATIOS[this.gear - 2].top : 0;
      const frac = clamp((this.speed - lo) / Math.max(1, b.top - lo), 0, 1);
      targetRpm = RPM_IDLE + (RPM_MAX - RPM_IDLE) * frac;
    } else if (this.gear === REVERSE && coupled) {
      targetRpm = RPM_IDLE + (RPM_MAX - RPM_IDLE) * clamp(this.speed / REVERSE_TOP, 0, 1);
    } else {
      targetRpm = RPM_IDLE + (RPM_MAX - RPM_IDLE) * 0.85 * this.torque;
    }
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
    this.refusal = null;
    // An upshift is a change of mind: whatever downshifts were waiting are dropped.
    if (direction > 0) this.queuedDown = 0;

    // The box runs R – N – 1 – 2 …, as most sequential boxes do. Down from
    // neutral is reverse, but only with the car stopped, so a paddle pulled
    // once too often at speed cannot select it.
    if (this.gear <= NEUTRAL) {
      if (direction < 0) {
        if (this.gear === NEUTRAL) return this.selectReverse();
        this.refusal = { direction, gear: this.gear, reason: 'bottom' };
        return false;
      }
      // Up from reverse is neutral — one step at a time, as the box is laid
      // out. Always allowed: neutral only lets the engine go.
      if (this.gear === REVERSE) {
        this.gear = NEUTRAL;
        this.lastShift = 1;
        this._shiftCooldown = 0.12;
        return true;
      }
      // Up from neutral goes into a forward gear — the lowest the speed
      // allows, so pulling it while coasting in neutral does not drop the
      // car into first at 200 km/h.
      if (this.direction < 0 && this.speed > CREEP) {
        this.refusal = { direction, gear: 1, reason: 'rolling-back' };
        return false;
      }
      this.gear = this.lowestGearFor(this.speed);
      this.lastShift = 1;
      this._shiftCooldown = 0.12;
      this._manualHold = 2.5;
      return true;
    }

    // Down from first is neutral, as on a sequential box. Harmless at any
    // speed: neutral only lets the engine go.
    if (direction < 0 && this.gear === 1) {
      this.gear = NEUTRAL;
      this.queuedDown = 0;
      this.lastShift = -1;
      this._shiftCooldown = 0.12;
      return true;
    }

    const next = clamp(this.gear + direction, 1, RATIOS.length);
    if (next === this.gear) {
      this.refusal = { direction, gear: this.gear, reason: direction > 0 ? 'top' : 'bottom' };
      return false;
    }
    if (direction < 0 && this.speed > RATIOS[next - 1].top * OVER_REV_ALLOWED) {
      // Too fast for that gear: refused, as a real box refuses it. With the
      // aid on, remembered instead, and taken the moment the speed allows.
      const queued = this.assists.queueDown;
      if (queued) {
        this.queuedDown = Math.min(this.queuedDown + 1, this.gear - 1);
        this._queueAge = 0;
      }
      this.refusal = { direction, gear: next, reason: 'too-fast', queued };
      return false;
    }
    this.gear = next;
    this.lastShift = direction;
    this._shiftCooldown = 0.12;
    this._manualHold = 2.5;
    return true;
  }

  /** The lowest forward gear that will take this speed. */
  lowestGearFor(speed) {
    const i = RATIOS.findIndex((r) => r.top * OVER_REV_ALLOWED >= speed);
    return i < 0 ? RATIOS.length : i + 1;
  }

  /** The N button: always allowed, as it is on the car. */
  selectNeutral() {
    this.refusal = null;
    if (this.gear === NEUTRAL) return false;
    this.gear = NEUTRAL;
    this.queuedDown = 0;
    return true;
  }

  /**
   * Reverse: only with the car all but stopped, as a gearbox without
   * synchromesh on reverse allows.
   */
  selectReverse() {
    this.refusal = null;
    if (this.gear === REVERSE) return false;
    if (this.speed > CREEP) {
      this.refusal = { direction: -1, gear: REVERSE, reason: 'moving' };
      return false;
    }
    this.gear = REVERSE;
    this.queuedDown = 0;
    return true;
  }

  /** A gear's top speed, km/h, and the fastest it can be dropped into. */
  gearLimits(gear) {
    const top = RATIOS[clamp(gear, 1, RATIOS.length) - 1].top;
    return { top, dropBelow: Math.floor(top * OVER_REV_ALLOWED) };
  }

  get telemetry() {
    return {
      gear: this.gear,
      /** What the display shows: R, N or the number. */
      gearLabel: gearLabel(this.gear),
      speed: this.speed,
      reversing: this.speed > 0.5 && this.direction < 0,
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
      torque: this.torque,
      brakeBar: this.pressure * BRAKE_BAR_MAX,
      brakeTemp: this.brakeTemp,
      wheelspin: this.wheelspin,
      lockup: this.lockup,
      accelG: this.accelG,
    };
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function gearLabel(gear) {
  return gear === REVERSE ? 'R' : gear === NEUTRAL ? 'N' : String(gear);
}

/**
 * How well carbon brakes bite at a temperature, as a fraction of their best.
 * Cold carbon has about a sixth of its working friction; it comes in through
 * 200–400 °C, is at its best to 1000 °C, and fades as it overheats.
 */
export function brakeTempFactor(temp) {
  if (temp <= 150) return 0.17;
  if (temp < 400) return 0.17 + 0.83 * ((temp - 150) / 250);
  if (temp <= 1000) return 1;
  return Math.max(0.6, 1 - (temp - 1000) / 500);
}
