/**
 * Resolves a team definition into the concrete numbers the renderer uses.
 *
 * Everything derived from a team's profile — the sampled outline, the
 * extrusion depth, the LED table, the total control count — is computed once
 * here, so no other module has to re-derive it and get it subtly different.
 */
import { TEAMS, DEFAULT_TEAM, LABEL_DROP } from './teams.js';
import { shellOutline } from './shell.js';

export { LABEL_DROP };
export { TEAMS, TEAM_IDS, DEFAULT_TEAM } from './teams.js';

/** Total steering lock each way, in degrees — about three-quarters of a turn. */
export const LOCK_DEGREES = 135;

/**
 * @param {string} teamId
 * @returns the fully derived spec for that wheel
 */
export function buildSpec(teamId = DEFAULT_TEAM) {
  const team = TEAMS[teamId] ?? TEAMS[DEFAULT_TEAM];
  const s = team.shell;

  const outline = shellOutline(s, 20);
  let halfWidth = 0, topY = -Infinity, bottomY = Infinity;
  for (const [x, y] of outline) {
    halfWidth = Math.max(halfWidth, Math.abs(x));
    topY = Math.max(topY, y);
    bottomY = Math.min(bottomY, y);
  }

  const shell = {
    ...s,
    outline,
    halfWidth,
    topY,
    bottomY,
    width: halfWidth * 2,
    height: topY - bottomY,
    frontZ: s.thickness / 2,
    backZ: -s.thickness / 2,
    // Bevelling adds `bevel` beyond each cap, so the extrusion has to run
    // short for the finished part to come out at `thickness`. Get this wrong
    // and everything mounted on the face sinks below it.
    extrudeDepth: s.thickness - s.bevel * 2,
  };

  return {
    id: team.id,
    name: team.name,
    // Composed from the measured outline rather than written by hand, so the
    // quoted width cannot drift away from the shape it describes.
    subtitle: `${team.tagline.split(' · ')[0]} · ${(shell.width * 1000).toFixed(0)} mm · ${team.tagline.split(' · ').slice(1).join(' · ')}`,
    livery: team.livery,
    shell,
    screen: team.screen,
    lightBar: team.lightBar,
    leds: buildLeds(team.lightBar),
    buttons: team.buttons,
    rotaries: team.rotaries,
    grip: team.grip,
    paddles: buildPaddles(shell, team),
    artwork: team.artwork,
    lockDegrees: LOCK_DEGREES,
    controlCount:
      team.buttons.length +
      team.rotaries.length +
      countSided(team.grip.thumbRotaries) +
      countSided(team.grip.thumbButtons) +
      4,                                    // the paddles
  };
}

const countSided = (list) => list.reduce((n, c) => n + (c.side === 0 ? 2 : 1), 0);

/**
 * Left-to-right LED order along the top edge: two marshalling flag LEDs at
 * each end, then fifteen rev LEDs running green → red → blue, which is the
 * sequence drivers shift on.
 */
function buildLeds(bar) {
  const out = [];
  // Spread across the bar rather than clustering centrally, otherwise the
  // strip reads as mostly empty housing with a few lights in the middle.
  const span = bar.width * 0.395;
  const flagX = bar.width * 0.463;
  const gap = bar.width * 0.042;

  for (const x of [-flagX, -flagX + gap]) out.push({ x, kind: 'flag', side: 'left' });
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({
      x: -span + t * span * 2,
      kind: 'rev',
      index: i,
      colour: i < 5 ? 'green' : i < 10 ? 'red' : 'blue',
      threshold: (i + 1) / (n + 1),
    });
  }
  for (const x of [flagX - gap, flagX]) out.push({ x, kind: 'flag', side: 'right' });
  return out;
}

/**
 * Paddles behind the shell.
 *
 * Teams differ here more than anywhere else on the wheel, and the differences
 * are physical rather than cosmetic:
 *
 *  · Ferrari  — large blades set low, sitting almost entirely behind the
 *               spokes, with a twin clutch pair.
 *  · Mercedes — a single wishbone clutch paddle on the centreline, with a
 *               finger socket moulded into it for feeling the bite point.
 *  · Red Bull — shorter blades and two extra flaps, because DRS and the
 *               overtake override are pulled from back here rather than
 *               pressed on the fascia.
 */
function buildPaddles(shell, team) {
  const w = shell.halfWidth;
  const shift = (side, id) => ({
    id, side, z: -0.0250, innerX: 0.0445, outerX: w * (team.paddles?.shiftReach ?? 0.855),
    y: team.paddles?.shiftY ?? 0.0060, height: team.paddles?.shiftHeight ?? 0.0560,
    bend: 0.0290, label: side < 0 ? 'DOWN' : 'UP',
  });

  const out = [shift(-1, 'downshift'), shift(1, 'upshift')];

  if (team.paddles?.clutch === 'wishbone') {
    // One paddle spanning the centreline rather than a pair.
    out.push({
      id: 'clutch', side: 1, z: -0.0455, innerX: -w * 0.34, outerX: w * 0.34,
      y: -0.0350, height: 0.0300, bend: 0.0120, label: 'CL', wishbone: true,
    });
  } else {
    for (const side of [-1, 1]) {
      out.push({
        id: side < 0 ? 'clutchL' : 'clutchR', side, z: -0.0455,
        innerX: 0.0415, outerX: w * 0.655, y: -0.0350, height: 0.0265,
        bend: 0.0135, label: 'CL',
      });
    }
  }

  for (const flap of team.paddles?.flaps ?? []) {
    out.push({
      id: flap.id, side: flap.side, z: -0.0620, innerX: 0.0520,
      outerX: w * 0.560, y: flap.y, height: 0.0195, bend: 0.0080, label: flap.label,
    });
  }

  return out;
}
