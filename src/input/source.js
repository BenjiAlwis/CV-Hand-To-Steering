/**
 * The contract every steering input must satisfy.
 *
 * Stage 1 ships a pointer source and a keyboard source. Stage 2's camera hand
 * tracker implements exactly this interface and is registered the same way —
 * nothing downstream of here needs to change when it arrives.
 */
export class SteeringSource {
  /**
   * @param {string} name       shown in the HUD
   * @param {number} priority   higher wins when several sources are live
   */
  constructor(name, priority = 0) {
    this.name = name;
    this.priority = priority;
    this.enabled = true;
  }

  /** Attach listeners, open the camera, etc. */
  async connect() {}

  /** Release anything `connect` acquired. */
  disconnect() {}

  /**
   * Called once per frame.
   *
   * @param {number} dt seconds since the previous frame
   * @returns {{angle: number, confidence: number}|null}
   *   `angle` is the requested wheel angle in radians — positive turns the
   *   wheel to the driver's right. `confidence` is 0..1 and lets the
   *   controller cross-fade away from a source that is losing its read
   *   (a hand leaving frame, say) instead of snapping to centre.
   *   Return `null` when the source has nothing to say this frame.
   */
  read(dt) {
    return null;
  }
}
