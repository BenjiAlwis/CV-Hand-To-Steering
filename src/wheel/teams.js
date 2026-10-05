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
  tagline: 'SF-25 · six selectors, six drums',

  // Measured from a straight-on photograph of the licensed full-size SF-25
  // replica (Leclerc), built from Ferrari's CAD, scaled to its 280 mm width;
  // the round caps measure as circles, so no tilt correction. The origin is
  // mid-height. SF-23, SF-24 and SF-25 share this shell: a gently arched top,
  // shoulders sweeping down into the grips, a window above each grip spoke,
  // and an open cut-out below it.
  shell: {
    stations: [
      // the body's bottom edge and its side
      [0, -0.0760], [0.0400, -0.0755], [0.0550, -0.0730], [0.0646, -0.0680],
      [0.0706, -0.0640], [0.0737, -0.0604], [0.0775, -0.0570], [0.0775, -0.0380],
      // the arch over the lower cut-out, up to the grip
      [0.0800, -0.0340], [0.0880, -0.0300], [0.0950, -0.0275], [0.1000, -0.0270],
      [0.1070, -0.0285], [0.1105, -0.0320],
      // behind the grip, up to the window's opening
      [0.1260, -0.0330], [0.1300, 0.0080],
      // the window above the spoke (its inner part filled by the SOC / EB drum)
      [0.1116, 0.0070], [0.1082, 0.0033], [0.1050, 0.0025], [0.1020, 0.0033],
      [0.0980, 0.0090], [0.0870, 0.0115],
      [0.0870, 0.0370], [0.0900, 0.0420], [0.0950, 0.0440], [0.0990, 0.0407],
      [0.1020, 0.0370], [0.1040, 0.0330], [0.1065, 0.0295], [0.1086, 0.0257],
      [0.1100, 0.0180],
      // back out behind the grip, then the shoulder
      [0.1300, 0.0180], [0.1392, 0.0280], [0.1380, 0.0330], [0.1360, 0.0407],
      [0.1328, 0.0482], [0.1290, 0.0557], [0.1244, 0.0632], [0.1189, 0.0707],
      [0.1155, 0.0744], [0.1123, 0.0779],
      // the top edge, a gentle arch
      [0.1029, 0.0796], [0.0936, 0.0813], [0.0842, 0.0828], [0.0749, 0.0838],
      [0.0655, 0.0847], [0.0561, 0.0860], [0.0468, 0.0867], [0.0374, 0.0872],
      [0.0281, 0.0875], [0.0187, 0.0884], [0, 0.0888],
    ],
    thickness: 0.0115, bevel: 0.0014,
    // Hex screws with chrome rings: two pairs on the display block, one low.
    bolts: [[0.0615, 0.0790], [0.0615, 0.0090], [0.0420, -0.0050]],
  },

  livery: {
    // Bare gloss carbon all over the face — no paint, no sponsor marks.
    weaveTint: '#34363a',
    accent: '#d40000',
    accentSoft: 'rgba(212,0,0,0.30)',
    inlay: false,
    ink: 'rgba(214,222,234,0.55)',
    stripe: null,
    buttonBezel: 'black',
    hudAccent: '#ff4d4d',
  },

  // A wide gull-wing shift plate behind the spokes and a long clutch below.
  paddles: { shiftY: -0.0060, shiftHeight: 0.0620, shiftReach: 0.800 },

  // Fifteen lights in a black window along the top of the display block,
  // 6.07 mm apart, and three flag lights in a slot either side of the glass.
  lightBar: {
    y: 0.0775, width: 0.0911, height: 0.0080, radius: 0.0016,
    inScreen: true, z: 0.0060, ledSize: 0.0042, unlit: '#7d8188', lens: false,
    flags: 'stacked', flagX: 0.0563, flagYs: [0.0690, 0.0628, 0.0565],
  },
  // The whole upper centre is a raised gloss-carbon block carrying the 93 ×
  // 54 mm glass, the lights, CHR, KO and the screws.
  screen: {
    x: 0, y: 0.0435, width: 0.0930, height: 0.0540, radius: 0.0015,
    bezel: 0.0215, bezelTop: 0.0125, bezelBottom: 0.0155,
    module: { depth: 0.0040, radius: 0.0060, finish: 'carbon', carriesFittings: true },
  },

  grip: {
    // One-tone matte black rubber, no finger grooves; each straight up the
    // outside and curling inward at the foot. Rows are [y, centre x, half-width].
    centreX: 0.1255, topY: 0.0260, bottomY: -0.0880,
    bowX: 0, z: 0.0, zRakeTop: 0,
    halfWidth: 0.0140, halfDepth: 0.0180,
    openTop: false,
    material: 'silicone',
    profile: [
      [0.0260, 0.1255, 0.0130], [0.0100, 0.1258, 0.0138], [-0.0100, 0.1258, 0.0138],
      [-0.0250, 0.1250, 0.0140], [-0.0400, 0.1245, 0.0130], [-0.0550, 0.1213, 0.0138],
      [-0.0650, 0.1183, 0.0143], [-0.0750, 0.1148, 0.0143], [-0.0850, 0.1150, 0.0090],
    ],
    // The round thumb bump on the rubber spoke.
    boss: { x: 0.0960, y: -0.0130, radius: 0.0060, flat: 0.45, zAt: 0.62 },
    thumbPad: null,
    fingerGrooves: 0,
    detached: true,
    joined: true,
    bridges: [],
    thumbRotaries: [],
    thumbButtons: [],
  },

  pods: [
    // The rubber spoke from grip to the BS / TRQ drum.
    { points: [[0.0820, 0.0040], [0.1120, 0.0040], [0.1120, -0.0280], [0.0980, -0.0270],
      [0.0860, -0.0220], [0.0820, -0.0120]], radius: 0.0070, depth: 0.0065, material: 'grip' },
    // Gloss-black mouldings round the big buttons in each top corner.
    { points: [[0.0640, 0.0470], [0.0660, 0.0420], [0.0730, 0.0405], [0.0800, 0.0440],
      [0.0880, 0.0500], [0.0970, 0.0545], [0.1060, 0.0545], [0.1140, 0.0590], [0.1155, 0.0670],
      [0.1120, 0.0750], [0.1040, 0.0780], [0.0950, 0.0750], [0.0860, 0.0695], [0.0770, 0.0610],
      [0.0660, 0.0550]], radius: 0.0030, depth: 0.0035, material: 'gloss' },
  ],

  // Legends on the caps; colours sampled from the replica.
  buttons: [
    { id: 'neutral', x: -0.1037, y: 0.0670, label: 'N', colour: '#199427', ink: '#0d0f0d', radius: 0.0068, lift: 0.0035 },
    { id: 'pitConfirm', x: -0.0864, y: 0.0608, label: 'PC', colour: '#dfe2e7', ink: '#d0251c', radius: 0.0050, lift: 0.0035 },
    { id: 'radio', x: -0.0715, y: 0.0496, label: 'RADIO', legend: 'RADIO', colour: '#c93524', ink: '#111111', radius: 0.0045, lift: 0.0035 },
    { id: 'rf', x: -0.0729, y: 0.0780, label: 'RF', colour: '#e8eaee', ink: '#d0251c', radius: 0.0037, height: 0.0024, bezel: false },
    { id: 'drs', x: -0.1100, y: 0.0465, label: 'DRS', colour: '#5a2fa8', ink: '#ffffff', radius: 0.0028 },
    { id: 'chr', x: -0.0630, y: 0.0214, label: 'CHR', colour: '#90b91d', ink: '#141612', radius: 0.0050 },

    { id: 'limiter', x: 0.1039, y: 0.0657, label: 'P', colour: '#d23f23', ink: '#111111', radius: 0.0068, lift: 0.0035 },
    { id: 'plus1', x: 0.0867, y: 0.0589, label: '1+', legend: '1\n+', split: ['#2b1b6c', '#e5cd03'],
      ink: ['#ffffff', '#111111'], colour: '#e5cd03', radius: 0.0045, lift: 0.0035 },
    { id: 'minus10', x: 0.0719, y: 0.0495, label: '10−', legend: '10\n−', split: ['#2b1b6c', '#e5cd03'],
      ink: ['#ffffff', '#111111'], colour: '#e5cd03', radius: 0.0045, lift: 0.0035 },
    { id: 'boost', x: 0.0720, y: 0.0772, label: 'K1', colour: '#eecc13', ink: '#d0251c', radius: 0.0039, height: 0.0024, bezel: false },
    { id: 'k2', x: 0.1112, y: 0.0429, label: 'K2', colour: '#edc617', ink: '#d0251c', radius: 0.0026 },
    { id: 'ko', x: 0.0630, y: 0.0210, label: 'KO', colour: '#e8eaee', ink: '#d0251c', radius: 0.0050 },
  ].map((b) => ({ labelSide: 'cap', height: 0.0050, ...b })),

  // Six selectors, each a tall black pointer knob over a printed dial;
  // the centre one a cogged ring round the yellow horse badge.
  rotaries: [
    {
      id: 'multi', x: -0.0385, y: -0.0245, radius: 0.0090, height: 0.0140, scale: 0.0130,
      label: 'MULTI', knobStyle: 'bat', pointAt: 0, detents: 12, value: 1, pointer: 0xffffff,
      band: {
        inner: 0.0040, outer: 0.0130, base: '#101114', textAt: 0.78,
        dividers: Array.from({ length: 12 }, (_, i) => 25 + i * 30), divider: 'rgba(230,234,240,0.55)',
        segments: [
          ['A', '#7cc8f0'], ['B', '#4aa3e8'], ['C', '#3a8fe0'], ['D', '#2f7ad8'], ['DO', '#ffffff'],
          ['STR', '#e0302a'], ['RB', '#d43aa8'], ['MIX', '#f0c419'], ['SPK', '#3fb34f'], ['GX', '#f08a24'],
          ['TUR', '#ffffff'], ['ERS', '#f0c419'],
        ].map(([text, ink], i) => ({ at: 10 + i * 30, width: 30, text, ink, size: 0.0024 })),
      },
    },
    {
      id: 'mode', x: 0, y: -0.0248, radius: 0.0150, height: 0.0150, scale: 0.0210,
      label: 'MODE', knobStyle: 'emblem', lobes: 18, emblem: '#f0cd02', detents: 12, value: 1, pointer: 0xffffff,
      band: {
        inner: 0.0160, outer: 0.0210, base: '#2a2b2e', divider: 'rgba(10,10,12,0.9)',
        dividers: Array.from({ length: 12 }, (_, i) => 15 + i * 30),
        segments: [
          ['RACE', '#d9dce0', '#111'], ['TS', '#8fd3f0', '#111'], ['FS1', '#e0662a', '#111'],
          ['FS2', '#be261e', '#111'], ['SC', '#d9dce0', '#111'], ['SLO', '#3a1d63', '#f0c419'],
          ['PSH', '#a9adb3', '#111'], ['WU', '#2fa3e0', '#111'], ['WUS', '#619d07', '#111'],
          ['FOR', '#cb481e', '#111'], ['BOX', '#e2cd10', '#111'], ['AD', null, '#f0c419'],
        ].map(([text, colour, ink], i) => ({ at: i * 30, width: 30, text, colour, ink, size: 0.0029 })),
      },
    },
    {
      id: 'diffMode', x: 0.0375, y: -0.0260, radius: 0.0090, height: 0.0140, scale: 0.0135,
      label: 'DIFF', knobStyle: 'bat', pointAt: 0, detents: 12, value: 1, pointer: 0xffffff,
      band: {
        inner: 0.0040, outer: 0.0135, base: '#101114', textAt: 0.76,
        dividers: [355, 115, 235], divider: 'rgba(10,10,12,0.9)',
        segments: [
          ['CHR', '#f2f3f5'], ['BM', '#f2f3f5'], ['KC', '#f2f3f5'], ['FM', '#f2f3f5'],
          ['WG', '#8cc63f'], ['D', '#8cc63f'], ['FC', '#8cc63f'], ['MOT', '#8cc63f'],
          ['DG', '#e8552a'], ['SAT', '#e8552a'], ['LT', '#e8552a'], ['REC', '#e8552a'],
        ].map(([text, colour], i) => ({ at: 10 + i * 30, width: 30, text, colour, ink: '#111', size: 0.0024 })),
      },
    },
    numberedDial('target', 'TARGET', -0.0545, -0.0535, 0.0134,
      ['#cf6f19', '#cf6f19', '#cf6f19', '#cf6f19', '#cf6f19', '#cf6f19',
        '#e8a812', '#e8a812', '#e8a812', '#e8a812', '#e8a812', '#e8a812']),
    numberedDial('tyrePhase', 'TYRE PHASE', -0.0005, -0.0590, 0.0130,
      ['#322871', '#64a703', '#e2cd00', '#f08a24', '#b7281c', '#f2f3f5',
        '#f2f3f5', '#f2f3f5', '#f2f3f5', '#f2f3f5', '#f08a24', '#f08a24'],
      { 10: 'S' }),
    numberedDial('eng', 'ENG', 0.0540, -0.0555, 0.0134,
      ['#d6262f', '#f08a24', '#f08a24', '#e2cd00', '#e2cd00', '#e2cd00',
        '#e2cd00', '#64a703', '#64a703', '#322871', '#322871', '#322871']),
  ],

  // Thumb drums: gold DIF IN and D MID on the shoulders, black SOC and EB
  // wheels standing in the windows, gold BS and TRQ at the ends of the spokes.
  rollers: [
    { id: 'difIn', x: -0.1227, y: 0.0337, axis: 80, colour: 'gold', label: 'DIF IN', radius: 0.0085, length: 0.0105,
      numbers: ['0', '−1', '−2', '−3', '−4', '−5', '±', '+5', '+4', '+3', '+2', '+1'] },
    { id: 'dMid', x: 0.1220, y: 0.0317, axis: -80, colour: 'gold', label: 'D MID', radius: 0.0085, length: 0.0105,
      numbers: ['0', '−1', '−2', '−3', '−4', '−5', '±', '+5', '+4', '+3', '+2', '+1'] },
    { id: 'soc', x: -0.0770, y: 0.0220, axis: 0, colour: 'black', label: 'SOC', radius: 0.0120, length: 0.0110,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], pointer: { dx: 0.0090, length: 0.0030 } },
    { id: 'eb', x: 0.0805, y: 0.0225, axis: 0, colour: 'black', label: 'EB', radius: 0.0120, length: 0.0110,
      numbers: ['0', '−1', '−2', '−3', '−4', '−5', '±', '+5', '+4', '+3', '+2', '+1'], pointer: { dx: -0.0075, length: 0.0030 } },
    { id: 'bs', x: -0.0760, y: -0.0120, axis: 0, colour: 'gold', label: 'BS', radius: 0.0090, length: 0.0100,
      numbers: ['0', '−1', '−2', '−3', '−4', '−5', '±', '+5', '+4', '+3', '+2', '+1'] },
    { id: 'trq', x: 0.0760, y: -0.0130, axis: 0, colour: 'gold', label: 'TRQ', radius: 0.0090, length: 0.0100,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  ],

  // Green indicator lenses in chrome bezels.
  indicators: [
    [-0.0905, 0.0755], [-0.0735, 0.0665], [-0.0640, 0.0350],
    [0.0705, 0.0670], [0.0875, 0.0735], [0.0620, 0.0360],
  ].map(([x, y]) => ({ x, y, colour: '#2f8f3a', radius: 0.0019, bezel: 'chrome' })),

  toggles: [{ x: 0.0275, y: -0.0555 }],

  // Raised gloss-black name tabs, and white legends printed on the block.
  tabs: [
    { text: 'BS', x: -0.0630, y: -0.0110, w: 0.0150, h: 0.0062 },
    { text: 'TRQ', x: 0.0600, y: -0.0125, w: 0.0170, h: 0.0062 },
    { text: 'SOC', x: -0.0505, y: 0.0245, w: 0.0115, h: 0.0042, angle: -90, depth: 0.0008 },
    { text: 'EB', x: 0.0505, y: 0.0240, w: 0.0075, h: 0.0042, angle: -90, depth: 0.0008 },
    { text: 'DIF IN', x: -0.1250, y: 0.0440, w: 0.0170, h: 0.0050, angle: -12, depth: 0.0008 },
    { text: 'D MID', x: 0.1260, y: 0.0440, w: 0.0160, h: 0.0050, angle: 12, depth: 0.0008 },
    { text: 'DRS  K2', x: -0.0355, y: 0.0843, w: 0.0200, h: 0.0042, plain: true },
  ],

  artwork: {
    wordmark: null,
    buildPlate: null,
    tags: [
      { text: 'TARGET', x: -0.0630, y: -0.0365, size: 0.0036, edge: true, track: 0.02 },
      { text: 'TYRE\nPHASE', x: -0.0260, y: -0.0620, size: 0.0032, edge: true, track: 0.02 },
      { text: 'ENG', x: 0.0610, y: -0.0375, size: 0.0036, edge: true, track: 0.02 },
      { text: 'P', x: 0.0270, y: -0.0490, size: 0.0034, edge: true },
      { text: 'S', x: 0.0270, y: -0.0630, size: 0.0034, edge: true },
    ],
  },
};

/**
 * A Ferrari dial printed in twelve numbered sectors, 1 at the top, each
 * number upright and in ink that reads on its sector.
 */
function numberedDial(id, label, x, y, outer, colours, rename = {}) {
  const lum = (hex) => {
    const h = hex.replace('#', '');
    return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16)
      + 0.114 * parseInt(h.slice(4, 6), 16)) / 255;
  };
  return {
    id, label, x, y, radius: 0.0090, height: 0.0140, scale: outer,
    knobStyle: 'bat', pointAt: 0, detents: 12, value: 1, pointer: 0xffffff,
    band: {
      inner: 0.0035, outer, base: '#101114', textAt: 0.74, upright: true,
      dividers: Array.from({ length: 12 }, (_, i) => 15 + i * 30), divider: 'rgba(10,10,12,0.55)',
      segments: colours.map((colour, i) => ({
        at: i * 30, width: 30, colour, text: rename[i + 1] ?? String(i + 1),
        ink: lum(colour) > 0.55 ? '#14161b' : '#ffffff', size: 0.0034,
      })),
    },
  };
}

/* ──────────────────────────── Mercedes ───────────────────────────── */

const mercedes = {
  id: 'mercedes',
  name: 'Mercedes',
  tagline: 'W-series · twelve buttons, six rollers',

  // Measured from the officially licensed replica of the 2024/25 wheel, which
  // follows the team's CAD; the layout has barely changed since 2019. Unlike
  // the others, the carbon body has no legs and no cut-out: it is a compact
  // block with a straight bottom edge and raised corners, and the grips are
  // separate silicone handles hung beside it, joined by carbon bridges with
  // open windows between — through which the shift paddle shows. The top
  // edge dips in the middle and rises to rounded corners over the grips.
  shell: {
    stations: [
      [0, -0.0560], [0.0600, -0.0565], [0.0880, -0.0545], [0.0970, -0.0480],
      [0.0980, -0.0200], [0.1000, -0.0050], [0.0930, 0.0040], [0.0800, 0.0110],
      [0.0790, 0.0400], [0.0900, 0.0470], [0.1120, 0.0480], [0.1240, 0.0530],
      [0.1170, 0.0634], [0.1107, 0.0701], [0.0960, 0.0790], [0.0810, 0.0810],
      [0.0600, 0.0765], [0.0510, 0.0749], [0, 0.0749],
    ],
    thickness: 0.0125, bevel: 0.0016,
    // Measured from the replica: a pair near the top, a pair low down.
    bolts: [[0.0760, 0.0736], [0.0550, -0.0460]],
  },

  livery: {
    // Bare gloss carbon all over: no teal paint, no wordmark on the face.
    // The team's mint shows only on the HPP rotary.
    weaveTint: '#272a30',
    accent: '#5fe0c6',
    accentSoft: 'rgba(95,224,198,0.25)',
    inlay: false,
    ink: 'rgba(210,222,232,0.55)',
    stripe: null,
    hudAccent: '#00d2be',
  },

  // A single clutch arm across the back, and the shift paddles visible
  // through the windows beside the body.
  paddles: { clutch: 'wishbone' },

  // The fifteen shift lights sit inside the display's glass, above the
  // screen — not in a bar along the top edge — reading white, red, blue,
  // with three flag LEDs stacked either side.
  lightBar: {
    y: 0.0640, width: 0.0920, height: 0.0070, radius: 0.0020,
    inScreen: true, z: 0.0048, sequence: ['white', 'red', 'blue'],
    flags: 'stacked', flagX: 0.0525, flagYs: [0.0540, 0.0490, 0.0440],
  },
  // A 4.3-inch screen in a raised black glass module about 117 × 76 mm.
  screen: {
    x: 0, y: 0.0290, width: 0.0940, height: 0.0560, bezel: 0.0105, radius: 0.0040,
    module: { depth: 0.0040, radius: 0.0060 },
  },

  grip: {
    // Smooth silicone handles, no finger grooves, hung outside the body.
    // Measured from the replica's front view: a gentle banana, about 33 mm
    // wide where it runs up under the top corner, bowing out to x ≈ 140 mm
    // just below the hub line and narrowing to about 21 mm at the bottom.
    // Each row is [y, centre x, half-width].
    centreX: 0.1240, topY: 0.0470, bottomY: -0.0810,
    bowX: 0, z: -0.0020, zRakeTop: 0.0020,
    halfWidth: 0.0150, halfDepth: 0.0175,
    // A rounded top tucked under the corner, the drum sitting on it.
    openTop: false,
    material: 'silicone',
    profile: [
      [0.0470, 0.1230, 0.0150], [0.0330, 0.1170, 0.0168], [0.0210, 0.1205, 0.0160],
      [0.0090, 0.1235, 0.0152], [-0.0090, 0.1255, 0.0148], [-0.0210, 0.1254, 0.0144],
      [-0.0390, 0.1242, 0.0132], [-0.0570, 0.1203, 0.0126], [-0.0690, 0.1194, 0.0108],
      [-0.0810, 0.1210, 0.0090],
    ],
    thumbPad: null,
    fingerGrooves: 0,
    detached: true,
    bridges: [{ fromX: 0.0950, y: -0.0070, height: 0.0160 }],
    thumbRotaries: [],
    thumbButtons: [],
  },

  // Six a side, no top row. Colours and legends as the 2024/25 wheel.
  buttons: [
    { id: 'drs', x: -0.1030, y: 0.0620, label: 'DRS', colour: 'yellow', radius: 0.0058, labelSide: 'cap' },
    { id: 'plus10', x: -0.0860, y: 0.0590, label: '+10', colour: 'purple', radius: 0.0058, labelSide: 'cap' },
    { id: 'neutral', x: -0.0700, y: 0.0480, label: 'N', colour: 'teal', radius: 0.0058, labelSide: 'cap' },
    { id: 'drink', x: -0.0650, y: 0.0050, label: 'DR', colour: 'orange', radius: 0.0058, labelSide: 'cap' },
    { id: 'cancel', x: -0.0670, y: -0.0150, label: 'X', colour: 'red', radius: 0.0058, labelSide: 'cap' },
    { id: 'bbDown', x: -0.0690, y: -0.0360, label: 'BB−', colour: 'black', radius: 0.0058, labelSide: 'cap' },

    { id: 'overtake', x: 0.1030, y: 0.0620, label: 'OT', colour: 'blue', radius: 0.0058, labelSide: 'cap' },
    { id: 'plus1', x: 0.0860, y: 0.0590, label: '+1', colour: 'purple', radius: 0.0058, labelSide: 'cap' },
    { id: 'limiter', x: 0.0700, y: 0.0480, label: 'PL', colour: 'yellow', radius: 0.0058, labelSide: 'cap' },
    { id: 'mark', x: 0.0650, y: 0.0050, label: 'MARK', legend: 'MARK\nPC', colour: 'white', radius: 0.0058, labelSide: 'cap' },
    { id: 'radio', x: 0.0670, y: -0.0150, label: 'RADIO', colour: 'green', radius: 0.0058, labelSide: 'cap' },
    { id: 'bbUp', x: 0.0690, y: -0.0360, label: 'BB+', colour: 'black', radius: 0.0058, labelSide: 'cap' },
  ],

  // Three low in the centre with pointed knobs and legend rings.
  // Three low in the centre: solid coloured, scalloped knobs, each in a
  // ring of coloured number tags; the menu rotary's modes printed round it.
  rotaries: [
    {
      id: 'strat', x: -0.0370, y: -0.0330, radius: 0.0092, height: 0.0080, scale: 0.0150,
      label: 'STRAT', pointer: 0xf0c419, knob: 0xf2c812, detents: 16, value: 4,
      ring: ['#f08a24', '#f08a24', '#f08a24', '#1f6fd0', '#1f6fd0', '#1f6fd0', '#1f6fd0', '#1f6fd0',
        '#1f6fd0', '#f0c419', '#f0c419', '#1f6fd0', '#14161b', '#2fae4e', '#f08a24', '#f08a24'],
      labelTag: { dx: -0.0150, dy: 0.0160, angle: 42, colour: '#f2c812' },
    },
    {
      id: 'menu', x: 0, y: -0.0310, radius: 0.0092, height: 0.0080, scale: 0.0150,
      label: 'MENU', pointer: 0x8e5bd9, knob: 0x6a2fc0, detents: 16, value: 1,
      ring: ['#5b2aa8'],
      legends: ['DEF', 'BITE', 'EXIT', 'INIT', 'CTRL', 'TRQ', 'CRUZ', 'VOL', 'REVS', 'DASH',
        'DISP', 'BRIG', 'SYS', 'WET', '', ''],
      legendColours: ['#d6262f', '#5b2aa8', '#5b2aa8', '#5b2aa8', '#5b2aa8', '#5b2aa8', '#5b2aa8',
        '#5b2aa8', '#1f9a4e', '#e8c015', '#d6262f', '#5b2aa8', '#5b2aa8', '#1fb3d6', '#5b2aa8', '#5b2aa8'],
    },
    {
      id: 'hpp', x: 0.0385, y: -0.0320, radius: 0.0092, height: 0.0080, scale: 0.0150,
      label: 'HPP', pointer: 0x5fe0c6, knob: 0x5fe0c6, detents: 16, value: 9,
      ring: ['#7fe8d3'],
      labelTag: { dx: 0.0150, dy: 0.0160, angle: -42, colour: '#5fe0c6' },
    },
  ],

  // Barrel thumb rollers let into the body: entry and high-speed
  // differential at the top corners, brake migration and balance beside the
  // display, mid-corner and engine braking at the bridges.
  // Barrel thumb rollers let into the body. Entry and high-speed
  // differential are big numbered drums at the top corners, their axles at
  // right angles to the corner's edge; brake migration and balance are short
  // gold barrels standing upright beside the display; mid-corner and engine
  // braking are numbered drums at the bridges.
  rollers: [
    { id: 'entry', x: -0.1160, y: 0.0490, axis: -37, colour: 'red', label: 'ENTRY', radius: 0.0068, length: 0.0120,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], labelAt: [0.0040, -0.0105] },
    { id: 'bmig', x: -0.0745, y: 0.0240, axis: 90, colour: 'gold', label: 'BMIG', radius: 0.0042, length: 0.0105,
      labelAt: [0.0115, -0.0020] },
    { id: 'mid', x: -0.0810, y: -0.0040, axis: 0, colour: 'silver', label: 'MID', radius: 0.0050, length: 0.0090,
      labelAt: [0.0010, -0.0095] },
    { id: 'hiSpeed', x: 0.1160, y: 0.0490, axis: 37, colour: 'blue', label: 'HI SPEED', radius: 0.0068, length: 0.0120,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], labelAt: [-0.0040, -0.0105] },
    { id: 'bbal', x: 0.0745, y: 0.0240, axis: 90, colour: 'gold', label: 'BBAL', radius: 0.0042, length: 0.0105,
      labelAt: [-0.0115, -0.0020] },
    { id: 'eb', x: 0.0810, y: -0.0040, axis: 0, colour: 'green', label: 'EB', radius: 0.0050, length: 0.0090,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], labelAt: [-0.0095, 0.0010] },
  ],

  artwork: {
    wordmark: null,
    buildPlate: null,
  },
};

/* ──────────────────────────── Red Bull ───────────────────────────── */

const redbull = {
  id: 'redbull',
  name: 'Red Bull',
  tagline: 'RB-series · twelve buttons, five rotaries, four rollers',

  // Measured from a straight-on photograph of the licensed full-size RB19
  // replica, scaled to its 280 mm width, with heights corrected for the
  // stand's 32° lean (every round button measures 0.85 as tall as wide).
  // The origin is mid-height, halfway between the top edge and the grip
  // bottoms. One carbon moulding: a body that
  // narrows towards a closed bottom bar, horn-like upper corners carrying
  // the big N and PIT buttons, roller housings outboard of the horns, and
  // the grips joined to it three times — under the horn, at the roller pod
  // and at the bar — with a window above and below the pod.
  shell: {
    stations: [
      [0, -0.0760], [0.0230, -0.0770], [0.0390, -0.0790], [0.0550, -0.0830],
      [0.0710, -0.0880], [0.0870, -0.0930], [0.1020, -0.0960], [0.1100, -0.0937],
      [0.1120, -0.0772], [0.1100, -0.0680],
      // the lower window, its inner side the body's edge
      [0.0960, -0.0675], [0.0780, -0.0670], [0.0700, -0.0620], [0.0716, -0.0490],
      [0.0760, -0.0300], [0.0830, -0.0150],
      // the roller pod's bridge to the grip
      [0.0900, -0.0095], [0.1080, -0.0070], [0.1120, 0.0075], [0.1100, 0.0404],
      // the upper window, closed by the horn
      [0.0960, 0.0410], [0.0790, 0.0420], [0.0760, 0.0480], [0.0765, 0.0560],
      [0.0800, 0.0610], [0.0880, 0.0640], [0.0990, 0.0630], [0.1080, 0.0590],
      // the arm outboard of the horn, carrying a roller
      [0.1250, 0.0540], [0.1310, 0.0600], [0.1290, 0.0700], [0.1260, 0.0830],
      [0.1200, 0.0880], [0.1130, 0.0880],
      // the horn, a notch, and the top edge crowning over the display housing
      [0.1050, 0.0970], [0.0970, 0.0995], [0.0850, 0.0985], [0.0770, 0.0965],
      [0.0680, 0.1010], [0.0620, 0.1040], [0.0300, 0.1062], [0, 0.1066],
    ],
    thickness: 0.0120, bevel: 0.0016,
    bolts: [[0.0600, 0.0260]],
  },

  livery: {
    weaveTint: '#2e3136',
    // The face is painted satin black; bare gloss carbon shows only on the
    // bottom bar and round the roller housings at the top corners.
    paint: {
      colour: '#1b1c20',
      roughness: 0.62,
      bare: [
        [[0, -0.0700], [0.0400, -0.0678], [0.0600, -0.0625], [0.0680, -0.0584],
          [0.0800, -0.0630], [0.1400, -0.0630], [0.1400, -0.1200], [0, -0.1200]],
        [[0.1060, 0.1100], [0.1400, 0.1100], [0.1400, 0.0520], [0.1060, 0.0520]],
      ],
    },
    buttonBezel: 'black',
    accent: '#e4002b',
    accentSoft: 'rgba(228,0,43,0.30)',
    inlay: false,
    ink: 'rgba(216,224,238,0.55)',
    stripe: null,
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

  // Fifteen shift lights along the top of the display housing, above the
  // glass, and three flag lights in a column either side of it.
  lightBar: {
    y: 0.0965, width: 0.0883, height: 0.0045, radius: 0.0018,
    inScreen: true, z: 0.0064,
    flags: 'stacked', flagX: 0.0542, flagYs: [0.0868, 0.0808, 0.0748],
  },
  // The 4.3-inch screen (95 × 54 mm, as on every car) in a deep satin-black
  // housing that stands proud of the face and forms the top of the wheel:
  // wide at the top, round the shift lights, narrowing to a neck beside the
  // glass.
  screen: {
    x: 0, y: 0.0612, width: 0.0940, height: 0.0530, radius: 0.0030,
    bezel: 0.0085, bezelTop: 0.0163, bezelBottom: 0.0120,
    module: { depth: 0.0055, radius: 0.0050, finish: 'satin', upper: { halfWidth: 0.0610, bottom: 0.0670 } },
  },

  grip: {
    // Grey moulded handles, about 38 mm across, with a black rubber sleeve
    // over the lower half. Each row is [y, centre x, half-width].
    centreX: 0.1190, topY: 0.0560, bottomY: -0.1070,
    bowX: 0, z: -0.0010, zRakeTop: 0.0010,
    halfWidth: 0.0190, halfDepth: 0.0200,
    openTop: false,
    material: 'greySilicone',
    // The cuff starts level with the tops of the lower windows.
    split: { y: -0.0260, proud: 0.05 },
    profile: [
      [0.0560, 0.1160, 0.0130], [0.0460, 0.1180, 0.0170], [0.0270, 0.1195, 0.0190],
      [0.0080, 0.1205, 0.0195], [-0.0110, 0.1195, 0.0190], [-0.0250, 0.1180, 0.0180],
      [-0.0490, 0.1185, 0.0180], [-0.0680, 0.1160, 0.0160], [-0.0870, 0.1110, 0.0140],
      [-0.1010, 0.1080, 0.0107],
    ],
    thumbPad: null,
    fingerGrooves: 0,
    // Hung beside the body, but the shell runs in behind it at three points.
    detached: true,
    joined: true,
    bridges: [],
    thumbRotaries: [],
    thumbButtons: [],
  },

  // Raised satin housings between body and grip, each carrying a roller.
  pods: [
    { points: [[0.0725, 0.0395], [0.0900, 0.0395], [0.0995, 0.0300], [0.0995, -0.0020],
      [0.0900, -0.0090], [0.0740, -0.0060]], radius: 0.0045, depth: 0.0075 },
  ],

  // Six a side. Legends on the caps; the big N and PIT up in the horns.
  buttons: [
    { id: 'neutral', x: -0.0934, y: 0.0828, label: 'N', colour: 'green', radius: 0.0068, labelSide: 'cap' },
    { id: 'minus10', x: -0.0735, y: 0.0716, label: '−10', colour: 'white', radius: 0.0052, labelSide: 'cap' },
    { id: 'auxL1', x: -0.0700, y: 0.0860, label: 'AUX', colour: 'black', radius: 0.0025, labelSide: 'none' },
    { id: 'auxL2', x: -0.0635, y: 0.0590, label: 'AUX', colour: 'black', radius: 0.0025, labelSide: 'none' },
    { id: 'radio', x: -0.0641, y: 0.0450, label: 'RADIO', legend: 'RADIO', colour: 'red', radius: 0.0053, labelSide: 'cap' },
    { id: 'bbDown', x: -0.0599, y: 0.0078, label: 'BB−', legend: 'BB\n−', colour: 'sky', radius: 0.0052, labelSide: 'cap' },
    { id: 'drink', x: -0.0604, y: -0.0116, label: 'DRINK', colour: 'yellow', radius: 0.0053, labelSide: 'none' },
    { id: 'anti', x: -0.1199, y: 0.0640, label: 'ANTI', colour: 'red', radius: 0.0043, labelSide: 'none' },

    { id: 'limiter', x: 0.0938, y: 0.0811, label: 'PIT', colour: 'red', radius: 0.0071, labelSide: 'cap' },
    { id: 'plus1', x: 0.0732, y: 0.0704, label: '+1', colour: 'white', radius: 0.0052, labelSide: 'cap' },
    { id: 'auxR1', x: 0.0700, y: 0.0860, label: 'AUX', colour: 'black', radius: 0.0025, labelSide: 'none' },
    { id: 'auxR2', x: 0.0635, y: 0.0590, label: 'AUX', colour: 'black', radius: 0.0025, labelSide: 'none' },
    { id: 'fail', x: 0.0638, y: 0.0439, label: 'FAIL', colour: 'orange', radius: 0.0053, labelSide: 'cap' },
    { id: 'bbUp', x: 0.0597, y: 0.0068, label: 'BB+', legend: 'BB\n+', colour: 'sky', radius: 0.0052, labelSide: 'cap' },
    { id: 'rev', x: 0.0600, y: -0.0123, label: 'REV', colour: 'yellow', radius: 0.0054, labelSide: 'cap' },
    { id: 'pc', x: 0.1194, y: 0.0628, label: 'PC+', colour: 'red', radius: 0.0043, labelSide: 'none' },
  ].map((b) => ({ height: 0.0055, ...b })),

  // Five in the centre: black knurled knobs named on their crowns, each in a
  // coloured anodised collar. TYRE and MODE stand in printed bands naming
  // their positions.
  rotaries: [
    {
      id: 'tyre', x: -0.0273, y: -0.0108, radius: 0.0070, collar: 0x0a55c8, collarRadius: 0.0117,
      scale: 0.0195, label: 'TYRE', detents: 12, value: 8, pointer: 0xffffff,
      band: {
        inner: 0.0146, outer: 0.0195, base: '#d5d9df',
        // Twelve 30° positions, clockwise from twelve o'clock.
        dividers: Array.from({ length: 12 }, (_, i) => 15 + i * 30),
        segments: [
          { at: 330, width: 30, colour: '#2fae4e' },
          { at: 0, width: 30, colour: '#2fae4e' },
          { at: 30, width: 30, colour: '#f0c419', text: '2', ink: '#14161b' },
          { at: 60, width: 30, colour: '#f08a24', text: '3', ink: '#14161b' },
          { at: 150, width: 30, colour: '#1f4fb8', text: 'EXT', size: 0.0026 },
          { at: 180, width: 30, colour: '#d6262f', text: 'BOX', size: 0.0026 },
          { at: 210, width: 30, colour: '#c21f3c', text: 'BOX', size: 0.0026 },
          { at: 240, width: 30, colour: '#5ab8e6', text: 'INT', size: 0.0026 },
        ],
      },
    },
    {
      id: 'strat', x: 0.0271, y: -0.0104, radius: 0.0070, collar: 0xd81a1c, collarRadius: 0.0117,
      scale: 0.0145, label: 'STRAT', detents: 12, value: 9, pointer: 0xffffff,
    },
    {
      id: 'engine', x: -0.0432, y: -0.0494, radius: 0.0070, collar: 0xd9dbe0, collarRadius: 0.0117,
      scale: 0.0145, label: 'ENGINE', detents: 12, value: 8, pointer: 0xffffff,
    },
    {
      id: 'disp', x: 0, y: -0.0442, radius: 0.0070, collar: 0xf2d000, collarRadius: 0.0117,
      scale: 0.0145, label: 'DISP', detents: 12, value: 9, pointer: 0xffffff,
    },
    {
      id: 'mode', x: 0.0432, y: -0.0507, radius: 0.0070, collar: 0x9a2aa0, collarRadius: 0.0117,
      scale: 0.0205, label: 'MODE', detents: 12, value: 9, pointer: 0xffffff,
      band: {
        inner: 0.0146, outer: 0.0205, base: '#24272d', divider: 'rgba(225,230,236,0.75)',
        dividers: Array.from({ length: 12 }, (_, i) => i * 30),
        segments: [
          { at: 15, width: 30, text: '+', size: 0.0036 },
          { at: 45, width: 30, text: '++', size: 0.0030 },
          { at: 105, width: 30, colour: '#2fae4e' },
          { at: 195, width: 30, colour: '#f0c419', text: 'Q+', ink: '#14161b', size: 0.0026 },
          { at: 255, width: 30, colour: '#e8452c', text: 'START', size: 0.0021 },
          { at: 285, width: 30, text: '−−', size: 0.0030 },
          { at: 315, width: 30, text: '−', size: 0.0036 },
          { at: 345, width: 30, text: 'RACE', size: 0.0021 },
        ],
      },
    },
  ],

  // Barrel rollers, each named in letters stacked down its side: brake
  // balance and mid-corner differential on the pods, differential and
  // torque outboard of the horns.
  rollers: [
    { id: 'bbal', x: -0.0830, y: 0.0170, axis: 0, colour: 'black', label: 'BBAL', radius: 0.0070, length: 0.0076,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], lift: 0.0075,
      labelVertical: true, labelBox: true, labelAt: [-0.0098, 0], labelHeight: 0.0200,
      pointer: { dx: 0.0068, length: 0.0040 } },
    { id: 'mid', x: 0.0830, y: 0.0170, axis: 0, colour: 'black', label: 'MID', radius: 0.0070, length: 0.0076,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], lift: 0.0075,
      labelVertical: true, labelBox: true, labelAt: [0.0098, 0], labelHeight: 0.0160,
      pointer: { dx: -0.0068, length: 0.0040 } },
    { id: 'diff', x: -0.1180, y: 0.0765, axis: 0, colour: 'black', label: 'DIFF', radius: 0.0052, length: 0.0060,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      labelVertical: true, labelAt: [-0.0080, 0], labelHeight: 0.0140 },
    { id: 'torq', x: 0.1180, y: 0.0765, axis: 0, colour: 'black', label: 'TORQ', radius: 0.0052, length: 0.0060,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      labelVertical: true, labelAt: [0.0080, 0], labelHeight: 0.0140 },
  ],

  artwork: {
    wordmark: null,
    buildPlate: null,
    tags: [
      { text: 'PULL', x: 0.0790, y: 0.0905, bg: '#d6262f', size: 0.0022 },
      { text: 'PUSH', x: 0.0745, y: 0.0580, bg: '#d6262f', size: 0.0022 },
      { text: 'PIT\nSTOP', x: 0.0455, y: -0.0235, size: 0.0017, ink: '#dfe4ea' },
      { text: 'ANTI', x: -0.1195, y: 0.0700, size: 0.0016, ink: '#e6e9ee' },
      { text: 'PC +', x: 0.1190, y: 0.0690, size: 0.0016, ink: '#e6e9ee' },
    ],
  },
};

/* ───────────────────────────── Basic wheel 1 ────────────────────── */

// A frozen copy of the Ferrari wheel as it stood when this was made, so it
// stays the same while the Ferrari itself carries on being refined.
const basic1 = {
  id: 'basic1',
  name: 'Basic wheel 1',
  tagline: 'Basic · six rotaries',

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
  basic1: hydrate(basic1),
};

export const TEAM_IDS = Object.keys(TEAMS);
export const DEFAULT_TEAM = 'ferrari';
