/**
 * The carbon shell's silhouette.
 *
 * A real Formula wheel is a single hollow carbon moulding, and its outline is
 * sculpted rather than cut: narrow legs at the bottom, hips that flare where
 * the grips are formed, a slight waist above them, broad shoulders carrying
 * the rev-light bar, and a top edge that arches. Describing that as a rounded
 * rectangle with a notch taken out — which is what this used to be — is what
 * made it read as a box.
 *
 * The outline is defined as stations threaded by a centripetal Catmull-Rom
 * spline, so every team profile is smooth by construction and tuning a shape
 * means moving a point rather than hand-balancing Bézier handles.
 *
 * Deliberately free of any Three.js import: the layout checker samples these
 * same curves in plain Node to prove no control hangs off the edge.
 */

/**
 * Stations around the right half of the shell, from the bottom centre of the
 * cut-out, up and over to the top centre. The left half is mirrored, so the
 * profile is symmetric by construction and only half of it can be wrong.
 *
 * @param {object} p a team's `shell` profile
 * @returns {Array<[number, number]>}
 */
export function shellStations(p) {
  const tip = p.legTipRadius;

  const stations = [
    // Bottom cut-out: a wide, shallow arch, not a V. It stays almost flat
    // either side of the centreline before turning down into the leg.
    [0, p.notchTopY],
    [p.legInnerX * 0.44, p.notchTopY - p.archFall * 0.13],
    [p.legInnerX * 0.86, p.notchTopY - p.archFall * 0.58],
    [p.legInnerX, p.notchTopY - p.archFall],

    // Inner face of the leg, down to its rounded tip.
    [p.legInnerX, p.legBottomY + tip * 1.10],
    [p.legInnerX + tip * 0.55, p.legBottomY],
    [p.legOuterX - tip * 0.55, p.legBottomY],
    [p.legOuterX, p.legBottomY + tip * 1.00],

    // The leg needs a real outer face before it turns back into the body.
    // Running straight from the tip to the knee makes the spline throw a
    // lobe off the bottom corner that looks like a heel.
    [p.legOuterX + p.legFlare, p.legBottomY + p.legFlankY],

    // The knee, where the leg widens back into the body.
    [p.legOuterX + p.legFlare + (p.kneeX - p.legOuterX - p.legFlare) * 0.52,
     p.legBottomY + p.legFlankY + (p.kneeY - p.legBottomY - p.legFlankY) * 0.58],
    [p.kneeX, p.kneeY],

    // Flank, up to the widest point of the shell.
    [p.sideX, p.sideY],
    [p.shoulderX, p.shoulderY],
  ];

  // A shoulder step — the notch that gives Red Bull's wheel its blocky,
  // Space-Invader outline. The flank reaches its widest, cuts sharply inward,
  // and only then carries on up to a narrower top.
  //
  // Both corners of the step are pinned with a point either side. A spline
  // through a bare corner overshoots it, and the overshoot here reads as a
  // pair of ears rather than a step.
  if (p.step) {
    const outer = p.shoulderX;
    const inner = p.shoulderX - p.step.inset;
    const r = p.step.rise;
    stations.push(
      [outer, p.step.y - r * 0.55],
      [outer - p.step.inset * 0.10, p.step.y - r * 0.12],
      [outer - p.step.inset * 0.50, p.step.y + r * 0.14],
      [inner + p.step.inset * 0.10, p.step.y + r * 0.40],
      [inner, p.step.y + r * 0.72],
      [inner, p.step.y + r * 1.35],
    );
  }

  const topX = p.step ? p.shoulderX - p.step.inset : p.shoulderX;

  // Shoulder into the top edge.
  stations.push(
    [topX - (topX - p.topCornerX) * 0.32, p.topY - p.cornerFall * 0.55],
    [p.topCornerX, p.topY],
  );

  // The top edge itself. `bend` folds it: the edge climbs from each corner to
  // a fold point and then runs almost level across the middle, which is what
  // makes the Mercedes outline read as folded rather than arched. The centre
  // has to sit at or above the fold — put it below and the edge dips into a
  // pair of humps with a valley between them.
  const apex = p.topY + (p.bend ? p.bend.rise + p.topArch : p.topArch);
  if (p.bend) {
    stations.push(
      [p.topCornerX * p.bend.at, p.topY + p.bend.rise],
      [p.topCornerX * p.bend.at * 0.55, apex - p.topArch * 0.25],
    );
  } else {
    stations.push([p.topCornerX * 0.50, p.topY + p.topArch * 0.70]);
  }

  stations.push([0, apex]);
  return stations;
}

/** The full closed loop: the right half, then its mirror image. */
export function shellLoop(p) {
  const right = shellStations(p);
  const left = right
    .slice(1, -1)                    // the two points on the axis are shared
    .reverse()
    .map(([x, y]) => [-x, y]);
  return [...right, ...left];
}

/* ───────────────────────── spline sampling ───────────────────────── */

/**
 * Centripetal Catmull-Rom through a closed loop of points.
 *
 * Centripetal (alpha = 0.5) rather than uniform: with stations bunched tightly
 * around the leg tips and spread out along the top edge, the uniform form
 * overshoots into cusps exactly where the shape needs to stay clean.
 */
export function sampleLoop(points, perSegment = 18, alpha = 0.5) {
  const n = points.length;
  const out = [];
  const at = (i) => points[((i % n) + n) % n];

  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);

    const t = [0, 0, 0, 0];
    for (let k = 1; k < 4; k++) {
      const a = [p0, p1, p2, p3][k - 1];
      const b = [p0, p1, p2, p3][k];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      t[k] = t[k - 1] + Math.pow(d || 1e-6, alpha);
    }

    for (let s = 0; s < perSegment; s++) {
      const tt = t[1] + ((t[2] - t[1]) * s) / perSegment;
      out.push(catmullRom(p0, p1, p2, p3, t, tt));
    }
  }
  return out;
}

function catmullRom(p0, p1, p2, p3, t, tt) {
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta || 1e-6);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t[0], t[1]);
  const a2 = lerp(p1, p2, t[1], t[2]);
  const a3 = lerp(p2, p3, t[2], t[3]);
  const b1 = lerp(a1, a2, t[0], t[2]);
  const b2 = lerp(a2, a3, t[1], t[3]);
  return lerp(b1, b2, t[1], t[2]);
}

/** The finished outline, ready to extrude or to test points against. */
export function shellOutline(p, perSegment = 18) {
  return sampleLoop(shellLoop(p), perSegment);
}

/* ─────────────────────── containment queries ─────────────────────── */

/** Standard ray-crossing test, used by the layout checker. */
export function isInside(outline, x, y) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i], [xj, yj] = outline[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to the outline — the clearance margin. */
export function distanceToEdge(outline, x, y) {
  let best = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [x1, y1] = outline[j], [x2, y2] = outline[i];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

/**
 * Does a disc of `radius` at (x, y) sit entirely on material?
 * Both tests are needed — a disc can straddle the edge with its centre inside.
 */
export function discFits(outline, x, y, radius) {
  return isInside(outline, x, y) && distanceToEdge(outline, x, y) >= radius;
}
