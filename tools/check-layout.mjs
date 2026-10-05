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
      // A button with no legend printed beside it has nothing to check there.
      noLabel: b.labelSide === 'none' || b.labelSide === 'cap',
      labelY: b.y + (b.labelSide === 'above' ? LABEL_DROP : -LABEL_DROP),
      labelHalfW: b.labelSide === 'none' || b.labelSide === 'cap' ? 0 : (b.label.length * CHAR_W.button) / 2,
    })),
    ...spec.rotaries.map((r) => ({
      id: r.id, x: r.x, y: r.y, r: r.scale,
      // A collar rotary carries its name on its own knob; a printed dial
      // (Ferrari) has its name printed as artwork of its own.
      noLabel: !!r.collar || !!r.band,
      labelY: r.y - r.scale - 0.0026,
      labelHalfW: (r.label.length * CHAR_W.rotary) / 2,
    })),
  ];

  const gripInnerX = grip.centreX - grip.halfWidth;
  const behindGrip = (y) => y < grip.topY && y > grip.bottomY;
  const barBottom = lightBar.y - lightBar.height / 2;
  // The display housing: its glass plus margins, and a wider upper part
  // where a team's housing has one (Red Bull's, round the shift lights).
  const dispTop = screen.y + screen.height / 2 + screen.bezelTop;
  const dispBottom = screen.y - screen.height / 2 - screen.bezelBottom;
  const upper = screen.module?.upper;
  // A housing that carries fittings (Ferrari's display block) only keeps
  // them off its glass.
  const fit = screen.module?.carriesFittings;
  const onDisplay = fit
    ? (x, y, r) => Math.abs(x) - r < screen.width / 2 + 0.002 && Math.abs(y - screen.y) - r < screen.height / 2 + 0.002
    : (x, y, r) =>
    (Math.abs(x) - r < screen.width / 2 + screen.bezel && y > dispBottom && y < dispTop) ||
    (upper && Math.abs(x) - r < upper.halfWidth && y > upper.bottom && y < dispTop);

  for (const a of items) {
    if (!discFits(outline, a.x, a.y, a.r + EDGE_MARGIN)) {
      const d = isInside(outline, a.x, a.y)
        ? `only ${(distanceToEdge(outline, a.x, a.y) * 1000).toFixed(1)} mm of edge clearance, needs ${((a.r + EDGE_MARGIN) * 1000).toFixed(1)}`
        : 'centre is off the shell entirely';
      flag(`${a.id}: does not fit on the carbon — ${d}`);
    }
    if (!a.noLabel && (!isInside(outline, a.x, a.labelY - LABEL_HALF_H) ||
        !isInside(outline, a.x - a.labelHalfW, a.labelY) ||
        !isInside(outline, a.x + a.labelHalfW, a.labelY))) {
      flag(`${a.id}: legend runs off the shell`);
    }
    if (Math.abs(a.x) + a.r > gripInnerX && behindGrip(a.y)) flag(`${a.id}: pocket falls behind a grip`);
    if (!a.noLabel && Math.abs(a.x) + a.labelHalfW > gripInnerX && behindGrip(a.labelY)) flag(`${a.id}: legend falls behind a grip`);
    // A bar inside the display module is covered by the display's own check.
    if (!lightBar.inScreen && a.y + a.r > barBottom) flag(`${a.id}: pocket runs into the rev-light bar`);
    if (onDisplay(a.x, a.y, a.r)) flag(`${a.id}: overlaps the display`);
    // A legend printed over the display is just as wrong as a pocket there.
    if (!a.noLabel && !fit && Math.abs(a.x) - a.labelHalfW < screen.width / 2 + screen.bezel &&
        a.labelY - LABEL_HALF_H < dispTop && a.labelY + LABEL_HALF_H > dispBottom) {
      flag(`${a.id}: legend is printed over the display`);
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) flag(`${a.id} / ${b.id}: pockets overlap`);
      if (!a.noLabel && Math.abs(a.x - b.x) < a.labelHalfW + b.r &&
          Math.abs(a.labelY - b.y) < LABEL_HALF_H + b.r) flag(`${a.id}: legend lands on ${b.id}'s pocket`);
      if (!a.noLabel && !b.noLabel && Math.abs(a.x - b.x) < a.labelHalfW + b.labelHalfW &&
          Math.abs(a.labelY - b.labelY) < LABEL_HALF_H * 2) flag(`${a.id} / ${b.id}: legends collide`);
    }
  }

  // The display and the light bar have to sit on carbon too.
  for (const [label, box] of [
    ['display', { x: screen.x, y: (dispTop + dispBottom) / 2, hw: screen.width / 2 + screen.bezel, hh: (dispTop - dispBottom) / 2 }],
    ...(upper ? [['display housing', { x: 0, y: (dispTop + upper.bottom) / 2, hw: upper.halfWidth, hh: (dispTop - upper.bottom) / 2 }]] : []),
    ...(lightBar.inScreen ? [] : [['light bar', { x: 0, y: lightBar.y, hw: lightBar.width / 2, hh: lightBar.height / 2 }]]),
  ]) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (!isInside(outline, box.x + dx * box.hw, box.y + dy * box.hh)) {
        flag(`${label}: a corner hangs off the shell`);
        break;
      }
    }
  }

  // A bar inside the display module has to sit inside its glass.
  if (lightBar.inScreen) {
    const top = dispTop;
    if (lightBar.y + lightBar.height / 2 > top) flag('light bar: rises out of the display module');
    if (lightBar.width / 2 > Math.max(screen.width / 2 + screen.bezel, upper?.halfWidth ?? 0)) flag('light bar: wider than the display module');
  }

  // Thumb rollers are let into the carbon: their centres must be on it, and
  // they must not sit on a button or rotary.
  for (const t of spec.rollers ?? []) {
    if (!isInside(outline, t.x, t.y)) flag(`${t.id}: roller is off the carbon`);
    // A drum's footprint on the face is a rectangle: its length along the
    // axle, its diameter across it.
    const ang = ((t.axis ?? 0) * Math.PI) / 180;
    for (const a of items) {
      const dx = a.x - t.x, dy = a.y - t.y;
      const u = Math.abs(dx * Math.cos(ang) + dy * Math.sin(ang)) - t.length / 2;
      const v = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)) - t.radius;
      const d = Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0);
      if (d < a.r * 0.9) flag(`${t.id}: roller sits on ${a.id}`);
    }
  }

  // The whole grip footprint has to land on carbon, not just its centreline —
  // the outer edge at the bottom is where it actually runs off the leg. A
  // grip hung beside the body instead (Mercedes) has to be joined to it.
  if (grip.detached) {
    const inner = grip.centreX - grip.halfWidth;
    if (!(grip.bridges ?? []).length && !grip.joined) flag('detached grips have no bridges to the body');
    if (inner - maxXAt(outline, grip.topY + 0.004) > 0.002) flag('detached grip top does not reach under the body');
  } else for (const side of [-1, 1]) {
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
