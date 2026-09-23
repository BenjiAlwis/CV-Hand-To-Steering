/**
 * Keyboard steering — A/D or the arrow keys.
 *
 * Ramps rather than jumps, and eases off when the key is released, so it
 * behaves enough like a real input to be worth testing the rig against.
 */
import { SteeringSource } from './source.js';

export class KeyboardSource extends SteeringSource {
  constructor({ priority = 5, rate = 2.4, lock = 2.36 } = {}) {
    super('keyboard', priority);
    this.rate = rate;       // radians per second at full deflection
    this.lock = lock;
    this.angle = 0;
    this.held = new Set();
    this._onDown = (e) => { if (KEYS[e.code]) { this.held.add(e.code); } };
    this._onUp = (e) => this.held.delete(e.code);
  }

  async connect() {
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  disconnect() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }

  sync(angle) {
    this.angle = angle;
  }

  read(dt) {
    if (!this.enabled) return null;
    let dir = 0;
    for (const code of this.held) dir += KEYS[code] ?? 0;
    if (dir === 0) return null;
    this.angle = clamp(this.angle + Math.sign(dir) * this.rate * dt, -this.lock, this.lock);
    return { angle: this.angle, confidence: 1 };
  }
}

const KEYS = {
  KeyA: -1, ArrowLeft: -1,
  KeyD: 1, ArrowRight: 1,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
