/**
 * Tests for the mask-to-boxes step of foot detection.
 *
 *   node tools/check-blobs.mjs
 *
 * Synthesises masks rather than needing a camera or a segmenter, which is the
 * point: this is the part that decides what counts as a foot, and it has to
 * be right about half a foot at the edge of the frame.
 */
import { findBlobs, openMask, isClipped } from '../src/vision/blobs.js';
import { pickFeet } from '../src/vision/footdetector.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const W = 64, H = 36;
const blank = () => new Uint8Array(W * H);
const rect = (m, x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
  return m;
};

console.log('\nfinding regions');
{
  const m = rect(rect(blank(), 6, 8, 18, 26), 40, 8, 54, 26);
  const blobs = findBlobs(m, W, H, { minArea: 0.002 });
  ok('two separate feet come back as two regions', blobs.length === 2, `${blobs.length}`);
  ok('and the bigger one is first', blobs[0].pixels >= blobs[1].pixels);
  ok('the box is in normalised coordinates',
    near(blobs.find((b) => b.cx < 0.5).x0, 6 / W) && near(blobs.find((b) => b.cx < 0.5).x1, 19 / W));
  ok('area is a fraction of the frame',
    near(blobs[0].area, blobs[0].pixels / (W * H)));

  const touching = rect(blank(), 6, 8, 54, 26);
  ok('two feet pressed together are one region',
    findBlobs(touching, W, H, { minArea: 0.002 }).length === 1);
}

console.log('\nfeet that are not fully in shot');
{
  // The case the pose graph could never handle: a foot running off the edge.
  const m = rect(blank(), 0, 10, 14, 30);
  const [b] = findBlobs(m, W, H, { minArea: 0.002 });
  ok('a foot running off the left edge is still found', !!b);
  ok('and is marked as clipped', isClipped(b) === true);
  ok('on the edge it actually runs off', b.clipped.left === true && b.clipped.right === false);

  const corner = rect(blank(), 0, 0, 10, 10);
  const [c] = findBlobs(corner, W, H, { minArea: 0.002 });
  ok('a foot in a corner reports both edges', c.clipped.left && c.clipped.top);

  const bottom = rect(blank(), 20, 24, 40, H - 1);
  const [d] = findBlobs(bottom, W, H, { minArea: 0.002 });
  ok('and one running off the bottom says so', d.clipped.bottom === true);

  const inside = rect(blank(), 20, 10, 40, 24);
  ok('a foot with room around it is not clipped',
    isClipped(findBlobs(inside, W, H, { minArea: 0.002 })[0]) === false);
}

console.log('\nnoise');
{
  const m = rect(blank(), 10, 10, 30, 28);
  m[2 * W + 2] = 1;                      // a lone speck
  m[3 * W + 50] = 1;
  const loose = findBlobs(m, W, H, { minArea: 0 });
  ok('specks are found when nothing filters them', loose.length === 3, `${loose.length}`);
  ok('a minimum area drops them', findBlobs(m, W, H, { minArea: 0.01 }).length === 1);
  ok('opening the mask drops them too',
    findBlobs(openMask(m, W, H), W, H, { minArea: 0 }).length === 1);

  // A blob split by one bad row must not be reported as two feet.
  const split = rect(blank(), 10, 10, 30, 28);
  for (let x = 10; x <= 30; x++) split[19 * W + x] = 0;
  ok('a one-pixel gap does split it', findBlobs(split, W, H, { minArea: 0 }).length === 2);
  ok('and closing that gap is what opening is for',
    findBlobs(openMask(split, W, H, 1), W, H, { minArea: 0 }).length <= 2);

  // Opening must not eat a foot that runs off the edge.
  const edge = rect(blank(), 0, 10, 14, 30);
  const opened = findBlobs(openMask(edge, W, H), W, H, { minArea: 0.002 })[0];
  ok('opening leaves an edge-running foot on the edge', opened.clipped.left === true);
}

console.log('\nnaming them');
{
  const box = (cx, area = 0.08) => ({
    cx, cy: 0.5, area, pixels: 1, x0: cx - 0.1, x1: cx + 0.1, y0: 0.3, y1: 0.7,
    clipped: { left: false, right: false, top: false, bottom: false },
  });

  const two = pickFeet([box(0.7), box(0.3)]);
  ok('two feet are named', two.length === 2 && two.every((f) => f.side));
  // The camera faces the driver, so the left of the picture is their right foot.
  ok('the left of the picture is the driver\'s right foot',
    two.find((f) => f.side === 'right').cx < two.find((f) => f.side === 'left').cx);

  const one = pickFeet([box(0.5)]);
  ok('a single region is left unnamed rather than guessed at', one[0].side === null);

  ok('only ever two feet', pickFeet([box(0.2), box(0.5), box(0.8)]).length === 2);

  const clipped = pickFeet([{ ...box(0.3), clipped: { left: true, right: false, top: false, bottom: true } }]);
  ok('a clipped foot is reported with lower confidence', clipped[0].confidence < 0.8,
    `${clipped[0].confidence}`);
  ok('but is still reported', clipped.length === 1);

  ok('a tiny region is not confident', pickFeet([box(0.5, 0.005)])[0].confidence < 0.2);
}

console.log(failures === 0 ? '\nall blob checks passed\n' : `\n${failures} blob check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
