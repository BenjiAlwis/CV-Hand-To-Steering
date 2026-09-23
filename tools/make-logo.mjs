/**
 * Generates the Wheelhouse mark.
 *
 *   node tools/make-logo.mjs            print the SVG fragment
 *   node tools/make-logo.mjs --preview  also write a standalone preview file
 *
 * The mark is the wheel itself, drawn by the same spline that draws the real
 * shells — so the logo cannot drift away from the thing it stands for. It gets
 * its own profile rather than borrowing a team's: a logo should be stable when
 * the default wheel changes, and it can afford to be a little more upright and
 * symmetric than any real fascia, which helps it hold together at small sizes.
 *
 * The output is pasted into `index.html` rather than built at runtime, because
 * the boot screen has to be on the page before any module has loaded.
 */
import { shellOutline } from '../src/wheel/shell.js';
import fs from 'node:fs';

const LOGO = {
  topY: 0.0990, topArch: 0.0038, topCornerX: 0.1105, cornerFall: 0.0300,
  shoulderX: 0.1400, shoulderY: 0.0520,
  sideX: 0.1360, sideY: -0.0120,
  kneeX: 0.1288, kneeY: -0.0470,
  legOuterX: 0.1160, legBottomY: -0.0890,
  legTipRadius: 0.0145, legFlare: 0.0030, legFlankY: 0.0250,
  // A wider, shallower cut-out than any of the real wheels carry. At the
  // size a logo is actually seen, the real proportions close up into a
  // keyhole; opening the arch is what keeps the two legs reading as legs.
  legInnerX: 0.0560, notchTopY: -0.0380, archFall: 0.0140,
};

/** Rev pips across the top, the same idea as the real light bar. */
const PIPS = { count: 11, y: 0.0690, width: 0.0158, height: 0.0140, span: 0.0965 };

const round = (n) => Number(n.toFixed(2));

function build() {
  const outline = shellOutline(LOGO, 16);

  // Fit the outline to a tidy viewBox with a little air around it.
  const pad = 0.010;
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const scale = 1000 / (maxX - minX);

  const X = (x) => round((x - minX) * scale);
  const Y = (y) => round((maxY - y) * scale);          // SVG y grows downward
  const W = round((maxX - minX) * scale);
  const H = round((maxY - minY) * scale);

  const d = outline
    .map(([x, y], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(y)}`)
    .join('') + 'Z';

  const pips = [];
  for (let i = 0; i < PIPS.count; i++) {
    const t = PIPS.count === 1 ? 0.5 : i / (PIPS.count - 1);
    const cx = -PIPS.span + t * PIPS.span * 2;
    pips.push({
      i,
      x: X(cx - PIPS.width / 2),
      y: Y(PIPS.y + PIPS.height / 2),
      w: round(PIPS.width * scale),
      h: round(PIPS.height * scale),
      // Green through red to blue, as the real bar runs.
      tone: t < 0.42 ? 'a' : t < 0.75 ? 'b' : 'c',
    });
  }

  return { d, pips, W, H };
}

const { d, pips, W, H } = build();

const fragment = `<svg class="mark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wheelhouse">
  <path class="mark-shell" pathLength="1" d="${d}"/>
${pips.map((p) => `  <rect class="pip" data-tone="${p.tone}" data-i="${p.i}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${round(p.w * 0.28)}"/>`).join('\n')}
</svg>`;

console.log(fragment);
console.error(`\n  ${pips.length} pips · viewBox ${W}×${H} · path ${d.length} chars`);

if (process.argv.includes('--write')) {
  // A coarser sampling of the same outline for the app icon: at 32 px the
  // fine spline detail is invisible, and a compact path keeps the file small.
  const icon = shellOutline(LOGO, 3);
  const ix = icon.map(([x]) => x), iy = icon.map(([, y]) => y);
  const iMinX = Math.min(...ix), iMaxX = Math.max(...ix);
  const iMinY = Math.min(...iy), iMaxY = Math.max(...iy);
  const s32 = 30 / (iMaxX - iMinX);
  const iD = icon
    .map(([x, y], i) => `${i ? 'L' : 'M'}${((x - iMinX) * s32 + 1).toFixed(1)} ${((iMaxY - y) * s32 + 1).toFixed(1)}`)
    .join('') + 'Z';
  const iH = ((iMaxY - iMinY) * s32 + 2).toFixed(1);
  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/icon.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 ${iH}">` +
    `<path d="${iD}" fill="none" stroke="#4dd4ff" stroke-width="2.4" stroke-linejoin="round"/></svg>\n`);
  console.error('  wrote assets/icon.svg');

  // Inject between the markers in index.html, so regenerating the mark is one
  // command rather than a careful paste.
  const page = 'index.html';
  const html = fs.readFileSync(page, 'utf8');
  const start = '<!-- logo:start -->', end = '<!-- logo:end -->';
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < 0) {
    console.error('  markers not found in ' + page);
    process.exit(1);
  }
  const indented = fragment.split('\n').map((l, i) => (i ? '      ' + l : l)).join('\n');
  fs.writeFileSync(page, html.slice(0, a + start.length) + '\n      ' + indented + '\n      ' + html.slice(b));
  console.error('  written into ' + page);
}

if (process.argv.includes('--preview')) {
  const out = `<!doctype html><meta charset="utf-8"><title>mark</title>
<body style="margin:0;background:#05070a;display:grid;place-items:center;height:100vh;gap:40px">
<div style="display:flex;align-items:flex-end;gap:56px">
  ${[220, 96, 48, 24].map((size) => `<div style="width:${size}px">${fragment
    .replace('class="mark"', 'style="width:100%;height:auto;overflow:visible"')
    .replace(/class="mark-shell" pathLength="1"/, 'fill="#12161d" stroke="#4dd4ff" stroke-width="9"')
    .replace(/class="pip" data-tone="a"/g, 'fill="#2fe07a"')
    .replace(/class="pip" data-tone="b"/g, 'fill="#ff6a3d"')
    .replace(/class="pip" data-tone="c"/g, 'fill="#6f7dff"')}</div>`).join('')}
</div></body>`;
  fs.writeFileSync(process.argv[process.argv.indexOf('--preview') + 1] ?? 'logo-preview.html', out);
  console.error('  preview written');
}
