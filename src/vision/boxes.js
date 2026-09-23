/**
 * Bounding boxes around the things the trackers found.
 *
 * Pure geometry, so it can be tested without a camera. Boxes are in the same
 * normalised space the landmarks arrive in, which means the drawing code can
 * place them without knowing what resolution anything ran at.
 */

/**
 * The smallest box holding every point, grown by `pad`.
 *
 * Padding is a fraction of the box's own size rather than a fixed amount, so
 * a hand close to the camera and one across the room get the same visual
 * margin instead of the far one being swallowed by its own border.
 *
 * Landmark models report points outside the frame when a hand or foot is half
 * out of shot — the estimate continues past the edge — so the box is kept as
 * measured and `clipped` records which edges it crosses. Clamping it to the
 * frame instead would quietly claim a hand ends exactly where the picture
 * does, which is the one thing it certainly does not do.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {{pad?: number}} [options]
 * @returns {{x0,y0,x1,y1,cx,cy,width,height,clipped}|null}
 */
export function boundingBox(points, { pad = 0.12 } = {}) {
  if (!points?.length) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let used = 0;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    used++;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (!used) return null;

  const px = (x1 - x0) * pad, py = (y1 - y0) * pad;
  x0 -= px; x1 += px; y0 -= py; y1 += py;

  return {
    x0, y0, x1, y1,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    width: x1 - x0, height: y1 - y0,
    clipped: { left: x0 < 0, right: x1 > 1, top: y0 < 0, bottom: y1 > 1 },
  };
}

/** Whether any edge of the box falls outside the picture. */
export const boxClipped = (b) =>
  !!b && (b.clipped.left || b.clipped.right || b.clipped.top || b.clipped.bottom);

/** How much of the box the camera can actually see, 0…1. */
export function visibleFraction(box) {
  if (!box) return 0;
  const w = Math.max(0, Math.min(1, box.x1) - Math.max(0, box.x0));
  const h = Math.max(0, Math.min(1, box.y1) - Math.max(0, box.y0));
  const whole = box.width * box.height;
  return whole <= 0 ? 0 : Math.max(0, Math.min(1, (w * h) / whole));
}

/** The box around one foot, from the three landmarks that describe it. */
export const footBox = (foot, options) =>
  foot ? boundingBox([foot.ankle, foot.heel, foot.toe], { pad: 0.2, ...options }) : null;

/** The box around one hand, from all twenty-one landmarks. */
export const handBox = (hand, options) => boundingBox(hand?.landmarks, options);
