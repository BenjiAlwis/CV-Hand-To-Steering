/**
 * Arbitrates between steering sources and gives the wheel its weight.
 *
 * Sources never drive the wheel directly. They post a *requested* angle and a
 * confidence; this class picks a winner, cross-fades when confidence drops,
 * and runs the result through a spring-damper so the wheel has inertia and
 * self-centres when nothing is holding it. That matters more than it sounds
 * for stage 2 — a camera tracker is jittery and occasionally loses the hands
 * entirely, and all of that is absorbed here rather than shaking the model.
 */
const DEG = Math.PI / 180;

export class SteeringController {
  constructor({
    lockDegrees = 135,
    stiffness = 320,      // how hard the wheel chases a held input
    damping = 30,
    returnStiffness = 46, // caster action when the wheel is let go
    // Damping ratio ~0.85: the wheel comes back to straight without the
    // visible flick past centre that a lighter value leaves behind.
    returnDamping = 11.6,
    /**
     * Ceiling on the feed-forward lead, in radians.
     *
     * Aiming ahead by velocity × damping / stiffness cancels the spring's
     * trail exactly, but it is unbounded: at an absurd 20 rad/s it would aim
     * 107° past the target and overshoot hard every time the hands reverse.
     * Capping it keeps the cancellation intact through any speed a driver
     * actually reaches and simply under-corrects beyond that.
     */
    maxLead = 0.6,
  } = {}) {
    this.lock = lockDegrees * DEG;
    this.stiffness = stiffness;
    this.damping = damping;
    this.returnStiffness = returnStiffness;
    this.returnDamping = returnDamping;
    this.maxLead = maxLead;

    /** @type {import('./source.js').SteeringSource[]} */
    this.sources = [];
    this.angle = 0;
    this.velocity = 0;
    this.target = 0;
    this.held = false;
    this.activeName = 'none';
    this.confidence = 0;
    this._fade = 0;
  }

  /** @param {import('./source.js').SteeringSource} source */
  async addSource(source) {
    await source.connect();
    this.sources.push(source);
    this.sources.sort((a, b) => b.priority - a.priority);
    return source;
  }

  removeSource(source) {
    const i = this.sources.indexOf(source);
    if (i >= 0) {
      source.disconnect();
      this.sources.splice(i, 1);
    }
  }

  recentre() {
    this.angle = 0;
    this.velocity = 0;
    this.target = 0;
    for (const s of this.sources) s.sync?.(0);
  }

  update(dt) {
    // Highest-priority source with something to say wins outright.
    let winner = null, reading = null;
    for (const source of this.sources) {
      const value = source.read(dt);
      if (value && value.confidence > 0.05) { winner = source; reading = value; break; }
    }

    if (reading) {
      // A spring trails a moving target by velocity × damping / stiffness —
      // about 90 ms here, which is 30° of error at a brisk 350°/s. A source
      // that knows how fast it is moving can hand that over, and aiming that
      // far ahead cancels the trail instead of stiffening the wheel until it
      // feels weightless.
      const lead = clamp(
        (reading.velocity ?? 0) * (this.damping / this.stiffness),
        -this.maxLead, this.maxLead,
      );
      this.target = clamp(reading.angle + lead, -this.lock, this.lock);
      // A source can ask for the wheel to be placed rather than driven to a
      // target. The camera uses it the moment your hands reappear: the wheel
      // matches where they actually are instead of spending a third of a
      // second springing across to it.
      if (reading.snap) {
        this.angle = this.target;
        this.velocity = 0;
      }
      this.activeName = winner.name;
      this.confidence = reading.confidence;
      this.held = true;
      this._fade = 1;
    } else {
      this.held = false;
      this.confidence = 0;
      // Ease the grip off rather than dropping it, so a tracker that blinks
      // for a frame does not make the wheel twitch.
      this._fade = Math.max(0, this._fade - dt * 4);
      if (this._fade <= 0) {
        this.activeName = 'none';
        this.target = 0;
      }
    }

    // Blend between "driven" and "self-centring" response.
    const k = lerp(this.returnStiffness, this.stiffness, this._fade);
    const c = lerp(this.returnDamping, this.damping, this._fade);

    // Sub-step so a long frame cannot make the spring explode.
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const accel = (this.target - this.angle) * k - this.velocity * c;
      this.velocity += accel * h;
      this.angle += this.velocity * h;

      if (this.angle > this.lock) { this.angle = this.lock; this.velocity = Math.min(0, this.velocity); }
      if (this.angle < -this.lock) { this.angle = -this.lock; this.velocity = Math.max(0, this.velocity); }
    }

    return this.angle;
  }

  /** −1 … +1, which is what a vehicle model wants. */
  get normalised() {
    return this.angle / this.lock;
  }

  get degrees() {
    return this.angle / DEG;
  }

  /** Lets a source resume from wherever the wheel currently is. */
  syncSources() {
    for (const s of this.sources) s.sync?.(this.angle);
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
