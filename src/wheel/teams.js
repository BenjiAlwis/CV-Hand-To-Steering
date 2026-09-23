/**
 * Team wheel specifications.
 *
 * Three wheels, modelled on the current Formula 1 grid. They differ in size,
 * silhouette, switch count and livery, which is genuinely how they differ in
 * the pit lane — every team lays its own wheel out, and the shell is a
 * one-piece carbon moulding that forms the grips as well as the fascia.
 *
 * Observed differences this file encodes:
 *
 *  · Ferrari  — the largest fascia and the most switchgear, around six
 *               rotaries. Two of them are thumb rotaries sitting where the
 *               thumbs naturally fall, handling entry and mid-corner
 *               differential.
 *  · Mercedes — a tighter shell with three multi-function rotaries grouped
 *               low and centre for strategy, sensors and engine modes, plus
 *               colour-coded thumb wheels for differential and harvesting.
 *  · Red Bull — deliberately the smallest and sparsest, with buttons deleted
 *               to save weight and to cut the risk of hitting the wrong one.
 *               Notably no big red DRS button on the fascia.
 *
 * Distances are metres, origin at the rotation axis, +x right, +y up.
 */

const BTN = { radius: 0.0068, height: 0.0040 };
const ROT = { radius: 0.0135, height: 0.0085 };

/** Drop from a cap's centre to the middle of its silkscreened legend. */
export const LABEL_DROP = 0.0125;

/* ───────────────────────────── Ferrari ───────────────────────────── */

const ferrari = {
  id: 'ferrari',
  name: 'Ferrari',
  tagline: 'SF-series · six rotaries',

  // "An elongated rectangle": the widest and flattest outline on the grid,
  // with a nearly straight top edge and corners that stay square rather than
  // rolling off. Height is kept down so the proportions read as stretched.
  shell: {
    topY: 0.0870, topArch: 0.0026, topCornerX: 0.1215, cornerFall: 0.0225,
    shoulderX: 0.1450, shoulderY: 0.0515,
    sideX: 0.1432, sideY: -0.0110,
    kneeX: 0.1372, kneeY: -0.0460,
    // The legs stay chunky on purpose: they are what carries the grips, so
    // tapering them to a point leaves the hand hanging off the carbon.
    legOuterX: 0.1240, legBottomY: -0.0860,
    legTipRadius: 0.0135, legFlare: 0.0026, legFlankY: 0.0235,
    // A shallower cut-out than its rivals, which is what leaves a band of
    // carbon across the bottom wide enough for the lower bank of selectors.
    legInnerX: 0.0480, notchTopY: -0.0640, archFall: 0.0120,
    thickness: 0.0115, bevel: 0.0014,
  },

  livery: {
    weaveTint: '#3a3f47',    // near-neutral: Ferrari runs bare carbon
    accent: '#d40000',
    accentSoft: 'rgba(212,0,0,0.30)',
    ink: 'rgba(214,222,234,0.55)',
    stripe: '#f2c327',       // the 12 o'clock reference mark
    hudAccent: '#ff4d4d',
  },

  // Leclerc's blades: larger, and set low enough to sit almost entirely
  // behind the spokes.
  paddles: { shiftY: -0.0060, shiftHeight: 0.0620, shiftReach: 0.800 },

  lightBar: { y: 0.0770, width: 0.2260, height: 0.0110, radius: 0.0038 },
  screen: { x: 0, y: 0.0240, width: 0.1020, height: 0.0540, bezel: 0.0055, radius: 0.0035 },

  grip: {
    centreX: 0.1080, topY: 0.0180, bottomY: -0.0700,
    bowX: 0.0068, z: 0.0192, zRakeTop: -0.0060,
    halfWidth: 0.0158, halfDepth: 0.0224,
    thumbPad: { y: -0.0020, width: 0.0132, height: 0.0215 },
    fingerGrooves: 4,
    // Ferrari's signature: the entry and mid-corner differential rotaries
    // sit where the thumbs naturally fall, one under each. With the four on
    // the fascia that makes six, which is what the team actually runs.
    thumbRotaries: [
      { id: 'difIn', side: -1, y: -0.0015, label: 'DIF IN', pointer: 0xe6e9ef, detents: 12, value: 5 },
      { id: 'difMid', side: 1, y: -0.0015, label: 'DIF MID', pointer: 0xd43a2a, detents: 12, value: 8 },
    ],
    thumbButtons: [],
  },

  buttons: [
    // Top band, between the display and the rev-light bar.
    { id: 'limiter', x: -0.0630, y: 0.0620, label: 'PIT', colour: 'orange', labelSide: 'above' },
    { id: 'mark', x: -0.0378, y: 0.0620, label: 'MARK', colour: 'white', labelSide: 'above' },
    { id: 'accept', x: -0.0126, y: 0.0620, label: 'OK', colour: 'green', labelSide: 'above' },
    { id: 'page', x: 0.0126, y: 0.0620, label: 'PAGE', colour: 'black', labelSide: 'above' },
    { id: 'oil', x: 0.0378, y: 0.0620, label: 'OIL', colour: 'black', labelSide: 'above' },
    { id: 'start', x: 0.0630, y: 0.0620, label: 'RS', colour: 'red', labelSide: 'above' },

    // Inboard columns. K1 is the electric boost; C is the drinks bottle.
    { id: 'bbUp', x: -0.0715, y: 0.0370, label: 'BB+', colour: 'black' },
    { id: 'bbDown', x: -0.0715, y: 0.0130, label: 'BB−', colour: 'black' },
    { id: 'neutral', x: -0.0715, y: -0.0110, label: 'N', colour: 'yellow' },

    { id: 'boost', x: 0.0715, y: 0.0370, label: 'K1', colour: 'blue' },
    { id: 'radio', x: 0.0715, y: 0.0130, label: 'RADIO', colour: 'black' },
    { id: 'drink', x: 0.0715, y: -0.0110, label: 'C', colour: 'magenta' },
  ],

  /**
   * Six selectors, and all of them low — Ferrari runs the most switchgear on
   * the grid and, unlike Mercedes, does not fold it into menus. Four sit in a
   * bank across the bottom; the entry and mid-corner differential pair sit
   * under the thumbs, which is where the hands already are.
   */
  rotaries: [
    { id: 'bs', x: -0.0300, y: -0.0340, scale: 0.0195, label: 'BS', pointer: 0xe6e9ef, detents: 12, value: 9 },
    { id: 'soc', x: 0.0300, y: -0.0340, scale: 0.0195, label: 'SOC', pointer: 0x36a0e0, detents: 12, value: 2 },
    { id: 'hpp', x: -0.0720, y: -0.0470, scale: 0.0195, label: 'HPP', pointer: 0xd43a2a, detents: 12, value: 4 },
    { id: 'trq', x: 0.0720, y: -0.0470, scale: 0.0195, label: 'TRQ', pointer: 0xe0b12a, detents: 12, value: 7 },
  ],

  artwork: {
    wordmark: { text: 'SCUDERIA', y: -0.0088, size: 0.0038, track: 0.38 },
    buildPlate: { text: 'CFRP 2×2 TWILL · 1.31 kg', y: -0.0780, size: 0.0022 },
  },
};

/* ──────────────────────────── Mercedes ───────────────────────────── */

const mercedes = {
  id: 'mercedes',
  name: 'Mercedes',
  tagline: 'W-series · three multi-function rotaries',

  // One of the longest wheels on the grid, and the only one whose top edge is
  // visibly folded rather than arched: it runs out level from the centre, then
  // bends down toward each corner.
  shell: {
    topY: 0.0885, topArch: 0.0016, topCornerX: 0.1085, cornerFall: 0.0300,
    bend: { at: 0.58, rise: 0.0060 },
    shoulderX: 0.1420, shoulderY: 0.0470,
    sideX: 0.1378, sideY: -0.0140,
    kneeX: 0.1322, kneeY: -0.0450,
    legOuterX: 0.1190, legBottomY: -0.0855,
    legTipRadius: 0.0145, legFlare: 0.0028, legFlankY: 0.0235,
    // A shallower cut-out than Ferrari's, which is what leaves room for the
    // row of multi-function rotaries low and centre.
    legInnerX: 0.0400, notchTopY: -0.0480, archFall: 0.0175,
    thickness: 0.0110, bevel: 0.0013,
  },

  livery: {
    weaveTint: '#2f3a40',    // a shade cooler, toward the team's graphite
    accent: '#00d2be',
    // The team's light green shows in one place only: the bottom right.
    corner: { x: 0.0760, y: -0.0700, width: 0.0340, height: 0.0090, colour: '#00d2be' },
    accentSoft: 'rgba(0,210,190,0.28)',
    ink: 'rgba(210,222,232,0.55)',
    stripe: '#e8ecf2',
    hudAccent: '#4dd4ff',
  },

  // One wishbone clutch paddle across the centreline rather than a pair,
  // with a finger socket for feeling the bite point.
  paddles: { clutch: 'wishbone' },

  lightBar: { y: 0.0755, width: 0.2000, height: 0.0115, radius: 0.0038 },
  screen: { x: 0, y: 0.0250, width: 0.0960, height: 0.0520, bezel: 0.0052, radius: 0.0034 },

  grip: {
    centreX: 0.0965, topY: 0.0165, bottomY: -0.0740,
    bowX: 0.0064, z: 0.0186, zRakeTop: -0.0058,
    halfWidth: 0.0154, halfDepth: 0.0218,
    thumbPad: { y: -0.0020, width: 0.0128, height: 0.0208 },
    fingerGrooves: 4,
    // Colour-coded thumb wheels: harvesting on the left, corner-entry
    // differential on the right.
    thumbRotaries: [
      { id: 'bmig', side: -1, y: -0.0010, label: 'BMIG', pointer: 0x6fd8ff, detents: 12, value: 6 },
      { id: 'difEntry', side: 1, y: -0.0010, label: 'ENTRY', pointer: 0xd43a2a, detents: 12, value: 9 },
    ],
    thumbButtons: [],
  },

  buttons: [
    { id: 'limiter', x: -0.0585, y: 0.0580, label: 'PIT', colour: 'yellow', labelSide: 'above' },
    { id: 'mark', x: -0.0351, y: 0.0580, label: 'MARK', colour: 'white', labelSide: 'above' },
    { id: 'accept', x: -0.0117, y: 0.0580, label: 'OK', colour: 'green', labelSide: 'above' },
    { id: 'page', x: 0.0117, y: 0.0580, label: 'PAGE', colour: 'black', labelSide: 'above' },
    { id: 'radio', x: 0.0351, y: 0.0580, label: 'RADIO', colour: 'black', labelSide: 'above' },
    { id: 'overtake', x: 0.0585, y: 0.0580, label: 'OT', colour: 'orange', labelSide: 'above' },

    { id: 'bbUp', x: -0.0690, y: 0.0350, label: 'BB+', colour: 'red' },
    { id: 'bbDown', x: -0.0690, y: 0.0110, label: 'BB−', colour: 'red' },
    { id: 'neutral', x: -0.0690, y: -0.0130, label: 'N', colour: 'green' },

    { id: 'drs', x: 0.0690, y: 0.0350, label: 'DRS', colour: 'blue' },
    { id: 'drink', x: 0.0690, y: 0.0110, label: 'DRINK', colour: 'black' },
    { id: 'start', x: 0.0690, y: -0.0130, label: 'RS', colour: 'black' },
  ],

  rotaries: [
    { id: 'strat', x: -0.0470, y: -0.0290, scale: 0.0150, label: 'STRAT', pointer: 0x6fd8ff, detents: 12, value: 4 },
    { id: 'sens', x: 0, y: -0.0250, scale: 0.0150, label: 'SENS', pointer: 0xe6e9ef, detents: 12, value: 7 },
    { id: 'mode', x: 0.0470, y: -0.0290, scale: 0.0150, label: 'MODE', pointer: 0x2fe07a, detents: 12, value: 9 },
  ],

  artwork: {
    wordmark: { text: 'PETRONAS', y: -0.0552, size: 0.0034, track: 0.34 },
    buildPlate: { text: 'CFRP · 1.28 kg', y: -0.0630, size: 0.0022 },
  },
};

/* ──────────────────────────── Red Bull ───────────────────────────── */

const redbull = {
  id: 'redbull',
  name: 'Red Bull',
  tagline: 'RB-series · pared back for weight',

  // The outline people describe as a Space Invader: the flank reaches its
  // widest, cuts sharply inward at the shoulder, and carries on to a narrower
  // top. That single step is what makes it read as blocky rather than moulded.
  shell: {
    topY: 0.0905, topArch: 0.0020, topCornerX: 0.0890, cornerFall: 0.0210,
    step: { y: 0.0545, rise: 0.0125, inset: 0.0210 },
    shoulderX: 0.1390, shoulderY: 0.0330,
    sideX: 0.1378, sideY: -0.0120,
    kneeX: 0.1330, kneeY: -0.0420,
    legOuterX: 0.1205, legBottomY: -0.0815,
    legTipRadius: 0.0140, legFlare: 0.0026, legFlankY: 0.0220,
    legInnerX: 0.0355, notchTopY: -0.0270, archFall: 0.0175,
    thickness: 0.0106, bevel: 0.0013,
  },

  livery: {
    weaveTint: '#26375e',    // the navy shell reads distinctly cooler
    accent: '#e4002b',
    accentSoft: 'rgba(228,0,43,0.30)',
    ink: 'rgba(216,224,238,0.55)',
    stripe: '#ffc906',
    hudAccent: '#ffc906',
  },

  // No DRS button on the fascia: DRS and the overtake override are flaps
  // behind the wheel, alongside the shifters.
  paddles: {
    shiftReach: 0.800,
    flaps: [
      { id: 'drs', side: 1, y: 0.0340, label: 'DRS' },
      { id: 'overtake', side: -1, y: 0.0340, label: 'OT' },
    ],
  },

  lightBar: { y: 0.0740, width: 0.1880, height: 0.0112, radius: 0.0036 },
  screen: { x: 0, y: 0.0110, width: 0.0940, height: 0.0480, bezel: 0.0050, radius: 0.0032 },

  grip: {
    centreX: 0.0925, topY: 0.0180, bottomY: -0.0700,
    bowX: 0.0060, z: 0.0182, zRakeTop: -0.0055,
    halfWidth: 0.0152, halfDepth: 0.0215,
    thumbPad: { y: -0.0020, width: 0.0126, height: 0.0202 },
    fingerGrooves: 4,
    thumbRotaries: [],
    thumbButtons: [
      { id: 'bite', y: 0.0045, label: 'BITE', colour: 'grey' },
      { id: 'preset', y: -0.0095, label: 'PRE', colour: 'grey' },
    ],
  },

  /**
   * Pared back to two short columns and nothing else.
   *
   * Red Bull deletes buttons rather than adding them — partly for weight,
   * partly so a driver cannot hit the wrong one. The fascia has no top band
   * at all, and famously no DRS button: DRS is a flap behind the wheel,
   * alongside the shifters.
   */
  buttons: [
    { id: 'neutral', x: -0.0670, y: 0.0330, label: 'N', colour: 'yellow' },
    { id: 'radio', x: -0.0670, y: 0.0070, label: 'RADIO', colour: 'black' },
    { id: 'limiter', x: -0.0670, y: -0.0190, label: 'PIT', colour: 'orange' },

    { id: 'bbUp', x: 0.0670, y: 0.0330, label: 'BB+', colour: 'black' },
    { id: 'drink', x: 0.0670, y: 0.0070, label: 'DRINK', colour: 'black' },
    { id: 'start', x: 0.0670, y: -0.0190, label: 'RS', colour: 'red' },
  ],

  // Toggles for tyres, strategy, engine and mode — the centre console set.
  rotaries: [
    { id: 'strat', x: -0.0940, y: 0.0450, scale: 0.0195, label: 'STRAT', pointer: 0xe4002b, detents: 12, value: 3 },
    { id: 'mode', x: 0.0940, y: 0.0450, scale: 0.0195, label: 'MODE', pointer: 0xffc906, detents: 12, value: 8 },
    { id: 'tyre', x: -0.0585, y: -0.0545, scale: 0.0185, label: 'TYRE', pointer: 0xe6e9ef, detents: 12, value: 6 },
    { id: 'engine', x: 0.0585, y: -0.0545, scale: 0.0185, label: 'ENG', pointer: 0x36a0e0, detents: 12, value: 4 },
  ],

  artwork: {
    wordmark: { text: 'ORACLE', y: -0.0215, size: 0.0038, track: 0.36 },
    buildPlate: { text: 'CFRP · 1.24 kg', y: -0.0285, size: 0.0022 },
  },
};

/* ───────────────────────────── exports ───────────────────────────── */

/** Give every control its shared geometry defaults. */
const hydrate = (team) => ({
  ...team,
  buttons: team.buttons.map((b) => ({ ...BTN, labelSide: 'below', ...b })),
  rotaries: team.rotaries.map((r) => ({ ...ROT, ...r })),
  grip: {
    ...team.grip,
    // `side` of -1 or 1 puts a control on one grip only; omitting it mirrors
    // the control onto both.
    thumbRotaries: (team.grip.thumbRotaries ?? []).map((r) => ({
      radius: 0.0058, height: 0.0042, side: 0, ...r,
    })),
    thumbButtons: (team.grip.thumbButtons ?? []).map((b) => ({
      radius: 0.0042, height: 0.0020, side: 0, ...b,
    })),
  },
});

export const TEAMS = {
  ferrari: hydrate(ferrari),
  mercedes: hydrate(mercedes),
  redbull: hydrate(redbull),
};

export const TEAM_IDS = Object.keys(TEAMS);
export const DEFAULT_TEAM = 'ferrari';
