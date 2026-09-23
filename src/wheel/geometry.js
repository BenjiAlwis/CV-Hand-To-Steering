/**
 * Geometry toolkit for the wheel.
 *
 * Nothing here is wheel-specific — these are the primitives that the moulded
 * carbon shell, the swept hand grips and the machined switchgear are built
 * from.
 */
import * as THREE from 'three';

/* ───────────────────── rounded polygon → THREE.Shape ───────────────────── */

/**
 * Builds a Shape from a polygon, filleting every vertex. Works for concave
 * corners too, which is what lets the faceplate carry its deep bottom notch
 * without the outline breaking.
 *
 * @param {Array<[number,number]>} pts   polygon vertices, counter-clockwise
 * @param {number|number[]} radius       fillet radius, per-vertex or uniform
 */
export function roundedPolyShape(pts, radius) {
  const n = pts.length;
  const radii = Array.isArray(radius) ? radius.slice() : new Array(n).fill(radius);
  const V = pts.map(([x, y]) => new THREE.Vector2(x, y));

  // Clamp each fillet so neighbouring fillets can never overlap.
  for (let i = 0; i < n; i++) {
    const prev = V[(i - 1 + n) % n], cur = V[i], next = V[(i + 1) % n];
    const lenA = cur.distanceTo(prev), lenB = cur.distanceTo(next);
    radii[i] = Math.min(radii[i], lenA * 0.49, lenB * 0.49);
  }

  const shape = new THREE.Shape();
  const entry = [], exit = [];
  for (let i = 0; i < n; i++) {
    const prev = V[(i - 1 + n) % n], cur = V[i], next = V[(i + 1) % n];
    const toPrev = prev.clone().sub(cur).normalize();
    const toNext = next.clone().sub(cur).normalize();
    entry[i] = cur.clone().addScaledVector(toPrev, radii[i]);
    exit[i] = cur.clone().addScaledVector(toNext, radii[i]);
  }

  shape.moveTo(exit[0].x, exit[0].y);
  for (let i = 1; i <= n; i++) {
    const k = i % n;
    shape.lineTo(entry[k].x, entry[k].y);
    shape.quadraticCurveTo(V[k].x, V[k].y, exit[k].x, exit[k].y);
  }
  shape.closePath();
  return shape;
}

/** Axis-aligned rounded rectangle centred on the origin. */
export function roundedRectShape(w, h, r) {
  return roundedPolyShape(
    [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
    r,
  );
}

/**
 * Re-projects UVs as a planar XY map over explicit bounds, so a hand-authored
 * decal atlas lines up exactly with the modelled outline.
 */
export function planarUV(geometry, minX, minY, maxX, maxY) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const sx = 1 / (maxX - minX), sy = 1 / (maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - minX) * sx, (pos.getY(i) - minY) * sy);
  }
  geometry.setAttribute('uv', uv);
  uv.needsUpdate = true;
  return geometry;
}

/* ───────────────────────────── switchgear ───────────────────────────── */

/**
 * A domed push-button cap: flat-ish crown, filleted shoulder, straight skirt.
 * Modelled as a lathe so the highlight rolls across it the way a real
 * anodised cap does.
 */
export function buttonCapGeometry(radius, height, { fillet = 0.38, dome = 0.09, segments = 40 } = {}) {
  const f = radius * fillet;
  const d = radius * dome;
  const pts = [];
  // Domed crown from the centre out to the start of the shoulder fillet.
  const crownR = radius - f;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(crownR * t, height + d * Math.cos((t * Math.PI) / 2) - d * 0.0));
  }
  // Shoulder fillet, quarter circle from vertical to horizontal.
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(crownR + f * Math.sin(a), height - f + f * Math.cos(a)));
  }
  pts.push(new THREE.Vector2(radius, 0));
  pts.push(new THREE.Vector2(radius * 0.94, 0));
  // LatheGeometry derives its normals from the walk direction and expects the
  // profile ordered bottom-to-top. Built crown-first above, so flip it —
  // otherwise every cap renders inside-out and reads as an empty bowl.
  pts.reverse();
  return new THREE.LatheGeometry(pts, segments);
}

/** The milled body of a rotary switch: knurled flank, chamfered top face. */
export function rotaryBodyGeometry(radius, height, { chamfer = 0.12, segments = 64 } = {}) {
  const c = radius * chamfer;
  const pts = [
    new THREE.Vector2(radius * 0.7, 0),
    new THREE.Vector2(radius - c * 0.6, 0),
    new THREE.Vector2(radius, c * 0.6),
    new THREE.Vector2(radius, height - c),
    new THREE.Vector2(radius - c, height),
    new THREE.Vector2(0, height),
  ];
  return new THREE.LatheGeometry(pts, segments);
}

/** A flat plate with rounded corners — LED lenses, screen bezels, badges. */
export function plateGeometry(w, h, r, depth, bevel = 0.0004) {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  planarUV(geo, -w / 2, -h / 2, w / 2, h / 2);
  return geo;
}
