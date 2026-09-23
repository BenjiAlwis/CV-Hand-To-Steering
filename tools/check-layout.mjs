/**
 * Layout check for every team wheel.
 *
 *   node tools/check-layout.mjs [team]
 *
 * The fascia is packed tight, and now that the shell is a sculpted spline
 * rather than a rectangle, "is this control still on the carbon?" is no longer
 * something you can answer by eye. This samples the real outline and tests
 * each control — and each silkscreened legend — for containment, clearance
 * and overlap. Runs in plain Node; no browser, no renderer.
 */
import { buildSpec, TEAM_IDS, LABEL_DROP } from '../src/wheel/spec.js';
import { discFits, distanceToEdge, isInside } from '../src/wheel/shell.js';

const CHAR_W = { button: 0.0021, rotary: 0.0032 };
const LABEL_HALF_H = 0.0018;
const POCKET = 1.18;          // a button's machined recess, relative to its cap
const EDGE_MARGIN = 0.0016;   // keep switchgear off the moulded edge radius

function checkTeam(id) {
  const spec = buildSpec(id);
  const { shell, grip, screen, lightBar } = spec;
  const outline = shell.outline;
  const issues = [];
  const flag = (m) => issues.push(m);

  const items = [
    ...spec.buttons.map((b) => ({
      id: b.id, x: b.x, y: b.y, r: b.radius * POCKET,
      labelY: b.y + (b.labelSide === 'above' ? LABEL_DROP : -LABEL_DROP),
      labelHalfW: (b.label.length * CHAR_W.button) / 2,
    })),
    ...spec.rotaries.map((r) => ({
      id: r.id, x: r.x, y: r.y, r: r.scale,
      labelY: r.y - r.scale - 0.0026,
      labelHalfW: (r.label.length * CHAR_W.rotary) / 2,
    })),
  ];

  const gripInnerX = grip.centreX - grip.halfWidth;
  const behindGrip = (y) => y < grip.topY && y > grip.bottomY;
  const barBottom = lightBar.y - lightBar.height / 2;

  for (const a of items) {
    if (!discFits(outline, a.x, a.y, a.r + EDGE_MARGIN)) {
      const d = isInside(outline, a.x, a.y)
        ? `only ${(distanceToEdge(outline, a.x, a.y) * 1000).toFixed(1)} mm of edge clearance, needs ${((a.r + EDGE_MARGIN) * 1000).toFixed(1)}`
        : 'centre is off the shell entirely';
      flag(`${a.id}: does not fit on the carbon — ${d}`);
    }
    if (!isInside(outline, a.x, a.labelY - LABEL_HALF_H) ||
        !isInside(outline, a.x - a.labelHalfW, a.labelY) ||
        !isInside(outline, a.x + a.labelHalfW, a.labelY)) {
      flag(`${a.id}: legend runs off the shell`);
    }
    if (Math.abs(a.x) + a.r > gripInnerX && behindGrip(a.y)) flag(`${a.id}: pocket falls behind a grip`);
    if (Math.abs(a.x) + a.labelHalfW > gripInnerX && behindGrip(a.labelY)) flag(`${a.id}: legend falls behind a grip`);
    if (a.y + a.r > barBottom) flag(`${a.id}: pocket runs into the rev-light bar`);
    if (Math.abs(a.x) - a.r < screen.width / 2 + screen.bezel &&
        Math.abs(a.y - screen.y) < screen.height / 2 + screen.bezel) flag(`${a.id}: overlaps the display`);
    // A legend printed over the display is just as wrong as a pocket there.
    if (Math.abs(a.x) - a.labelHalfW < screen.width / 2 + screen.bezel &&
        Math.abs(a.labelY) - LABEL_HALF_H < screen.y + screen.height / 2 + screen.bezel &&
        a.labelY + LABEL_HALF_H > screen.y - screen.height / 2 - screen.bezel) {
      flag(`${a.id}: legend is printed over the display`);
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) flag(`${a.id} / ${b.id}: pockets overlap`);
      if (Math.abs(a.x - b.x) < a.labelHalfW + b.r &&
          Math.abs(a.labelY - b.y) < LABEL_HALF_H + b.r) flag(`${a.id}: legend lands on ${b.id}'s pocket`);
      if (Math.abs(a.x - b.x) < a.labelHalfW + b.labelHalfW &&
          Math.abs(a.labelY - b.labelY) < LABEL_HALF_H * 2) flag(`${a.id} / ${b.id}: legends collide`);
    }
  }

  // The display and the light bar have to sit on carbon too.
  for (const [label, box] of [
    ['display', { x: screen.x, y: screen.y, hw: screen.width / 2 + screen.bezel, hh: screen.height / 2 + screen.bezel }],
    ['light bar', { x: 0, y: lightBar.y, hw: lightBar.width / 2, hh: lightBar.height / 2 }],
  ]) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (!isInside(outline, box.x + dx * box.hw, box.y + dy * box.hh)) {
        flag(`${label}: a corner hangs off the shell`);
        break;
      }
    }
  }

  // The whole grip footprint has to land on carbon, not just its centreline —
  // the outer edge at the bottom is where it actually runs off the leg.
  for (const side of [-1, 1]) {
    for (const [name, y] of [['top', grip.topY], ['bottom', grip.bottomY]]) {
      for (const [edge, dx] of [['inner', -grip.halfWidth], ['centre', 0], ['outer', grip.halfWidth]]) {
        const x = side * grip.centreX + side * dx;
        if (!isInside(outline, x, y)) {
          const room = maxXAt(outline, y);
          flag(`grip ${name} ${edge} edge is off the shell at y=${(y * 1000).toFixed(0)}mm ` +
               `(needs |x| ≤ ${(room * 1000).toFixed(1)}mm, sits at ${(Math.abs(x) * 1000).toFixed(1)}mm)`);
        }
      }
    }
  }

  return { spec, issues: [...new Set(issues)] };
}

/** Widest point of the shell at a given height — what a grip has to fit in. */
function maxXAt(outline, y) {
  let best = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [x1, y1] = outline[j], [x2, y2] = outline[i];
    if ((y1 > y) !== (y2 > y)) {
      const t = (y - y1) / (y2 - y1);
      best = Math.max(best, Math.abs(x1 + t * (x2 - x1)));
    }
  }
  return best;
}

const requested = process.argv[2];
const ids = requested ? [requested] : TEAM_IDS;
let failed = 0;

for (const id of ids) {
  const { spec, issues } = checkTeam(id);
  const head = `${spec.name.padEnd(9)} ${(spec.shell.width * 1000).toFixed(0)}mm · ` +
    `${spec.buttons.length} buttons · ${spec.rotaries.length} fascia rotaries · ${spec.controlCount} controls`;
  if (issues.length) {
    failed++;
    console.error(`✗ ${head}\n    ${issues.join('\n    ')}`);
  } else {
    console.log(`✓ ${head}`);
  }
}

process.exit(failed ? 1 : 0);
