/**
 * Tests for the bounding boxes drawn over the camera views.
 *
 *   node tools/check-boxes.mjs
 *
 * The interesting case is a hand or foot that is only half in shot, because
 * landmark models keep estimating past the edge of the picture and a box has
 * to say so rather than pretending the hand stops where the frame does.
 */
import { boundingBox, boxClipped, visibleFraction, handBox, footBox } from '../src/vision/boxes.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('\nboxing points');
{
  const pts = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.5 }, { x: 0.5, y: 0.45 }];
  const b = boundingBox(pts, { pad: 0 });
  ok('the box holds every point',
    near(b.x0, 0.4) && near(b.x1, 0.6) && near(b.y0, 0.4) && near(b.y1, 0.5));
  ok('and reports its centre', near(b.cx, 0.5) && near(b.cy, 0.45));
  ok('and its size', near(b.width, 0.2) && near(b.height, 0.1));

  // Padding in proportion, so a close hand and a far one look the same.
  const near_ = boundingBox([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], { pad: 0.1 });
  const far = boundingBox([{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.55 }], { pad: 0.1 });
  ok('padding scales with the box rather than being fixed',
    near(near_.width / 0.6, far.width / 0.1, 1e-9),
    `${near_.width.toFixed(3)} vs ${far.width.toFixed(3)}`);

  ok('nothing to box gives nothing back', boundingBox([]) === null && boundingBox(null) === null);
  ok('a broken landmark is skipped, not believed',
    near(boundingBox([{ x: NaN, y: 0.5 }, { x: 0.3, y: 0.3 }], { pad: 0 }).x0, 0.3));
  ok('all-broken landmarks give nothing back',
    boundingBox([{ x: NaN, y: NaN }]) === null);
}

console.log('\nhalf out of shot');
{
  // A hand leaving frame: the model keeps estimating past the edge.
  const b = boundingBox([{ x: -0.2, y: 0.3 }, { x: 0.2, y: 0.7 }], { pad: 0 });
  ok('a box past the edge is kept as measured, not clamped', near(b.x0, -0.2));
  ok('and says which edge it crosses', b.clipped.left && !b.clipped.right);
  ok('boxClipped agrees', boxClipped(b) === true);
  ok('half the box visible reads as half', near(visibleFraction(b), 0.5, 1e-9),
    visibleFraction(b).toFixed(3));

  const inside = boundingBox([{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }], { pad: 0 });
  ok('a box inside the frame is not clipped', boxClipped(inside) === false);
  ok('and is fully visible', near(visibleFraction(inside), 1));

  const gone = boundingBox([{ x: 1.4, y: 0.3 }, { x: 1.8, y: 0.7 }], { pad: 0 });
  ok('a box entirely outside is nothing visible', near(visibleFraction(gone), 0));

  const corner = boundingBox([{ x: -0.1, y: -0.1 }, { x: 0.3, y: 0.3 }], { pad: 0 });
  ok('a corner reports both edges', corner.clipped.left && corner.clipped.top);
  ok('and a quarter off each way leaves most of it', visibleFraction(corner) > 0.5);
}

console.log('\nhands and feet');
{
  const hand = { landmarks: Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i * 0.004, y: 0.5 + i * 0.002 })) };
  const hb = handBox(hand);
  ok('a hand is boxed from all of its landmarks', hb && hb.x1 > hb.x0);
  ok('a hand with no landmarks gives nothing', handBox({}) === null && handBox(null) === null);

  const foot = { ankle: { x: 0.30, y: 0.40 }, heel: { x: 0.30, y: 0.50 }, toe: { x: 0.45, y: 0.48 } };
  const fb = footBox(foot, { pad: 0 });
  ok('a foot is boxed from ankle, heel and toe',
    near(fb.x0, 0.30) && near(fb.x1, 0.45) && near(fb.y0, 0.40) && near(fb.y1, 0.50));
  ok('no foot gives no box', footBox(null) === null);

  // The foot box is padded more than the hand's: three points describe far
  // less of a foot than twenty-one do of a hand.
  ok('feet get more padding than hands',
    footBox(foot).width - fb.width > handBox(hand).width - boundingBox(hand.landmarks, { pad: 0 }).width);
}

console.log(failures === 0 ? '\nall box checks passed\n' : `\n${failures} box check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
