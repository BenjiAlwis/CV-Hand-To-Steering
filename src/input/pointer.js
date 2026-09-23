/**
 * Mouse / touch steering.
 *
 * Grabbing anywhere on the canvas and swinging around the wheel's projected
 * centre turns it, so the gesture is the same one the hand tracker will read
 * from the camera — rotate about a pivot rather than slide along an axis.
 */
import { SteeringSource } from './source.js';

export class PointerSource extends SteeringSource {
  /**
   * @param {HTMLElement} element
   * @param {() => {x:number, y:number}} getPivot  wheel centre, in CSS pixels
   */
  constructor(element, getPivot, { priority = 10 } = {}) {
    super('pointer', priority);
    this.element = element;
    this.getPivot = getPivot;
    this.angle = 0;
    this.dragging = false;
    this._last = 0;
    this._touched = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  async connect() {
    this.element.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  disconnect() {
    this.element.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
  }

  _bearing(event) {
    const pivot = this.getPivot();
    return Math.atan2(event.clientY - pivot.y, event.clientX - pivot.x);
  }

  _onDown(event) {
    if (event.button !== 0 || !this.enabled) return;
    this.dragging = true;
    this._touched = true;
    this._last = this._bearing(event);
    this.element.setPointerCapture?.(event.pointerId);
    this.element.classList.add('grabbing');
  }

  _onMove(event) {
    if (!this.dragging) return;
    const now = this._bearing(event);
    let d = now - this._last;
    // Keep the delta on the short arc so crossing the ±π seam does not spin
    // the wheel a full turn.
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this._last = now;
    // Screen y grows downward, so a clockwise drag is a positive bearing
    // delta — which is the driver turning right.
    this.angle += d;
  }

  _onUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.classList.remove('grabbing');
    this.element.releasePointerCapture?.(event.pointerId);
  }

  /** Seeds the source so it picks up wherever the wheel currently sits. */
  sync(angle) {
    this.angle = angle;
  }

  read() {
    if (!this.enabled || !this._touched) return null;
    // Holding the wheel is full confidence; letting go hands control back so
    // the self-centring spring can take over.
    return this.dragging ? { angle: this.angle, confidence: 1 } : null;
  }
}
