/**
 * Records a dataset from the foot camera.
 *
 *   npm run footshots [count] [outDir]
 *
 * Writes a PNG per frame and a JSON alongside it holding the boxes the
 * detector found, in the normalised xyxy the rest of the project uses.
 *
 * Those boxes are pre-labels, not labels. The point of recording with them is
 * that correcting a box someone else drew is perhaps five times quicker than
 * drawing it from nothing, and the frames where the detector is wrong are
 * exactly the ones a trained model would need to see — a foot half out of
 * shot, a foot in socks, a foot against a warm wooden floor. Keep those.
 * Delete nothing because it looks bad.
 *
 * Run the standalone detector page first (`npm run feet`) with the camera
 * going, then this against it.
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const COUNT = Number(process.argv[2] ?? 40);
const OUT = process.argv[3] ?? 'dataset/feet';
const EVERY_MS = 400;

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
if (!list) {
  console.error(`\n  Nothing is listening on ${PORT}. Start the rig with:\n\n      npm start -- --remote-debugging-port=${PORT}\n\n  then open the detector page in it.\n`);
  process.exit(1);
}
const target = list.find((t) => t.url?.includes('feet.html')) ?? list.find((t) => t.url?.includes('127.0.0.1'));
if (!target) { console.error('  Could not find a Wheelhouse window.'); process.exit(1); }

const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  const fn = pending.get(m.id);
  if (fn) { pending.delete(m.id); fn(m); }
});
await new Promise((r) => socket.addEventListener('open', r));
const evaluate = (expression) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, (m) => m.result?.exceptionDetails
    ? rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400)))
    : res(m.result?.result?.value));
  socket.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
});

const ready = await evaluate(`(() => {
  const v = document.getElementById('feed');
  if (!v) return 'the detector page is not open — run npm run feet';
  if (v.readyState < 2) return 'the camera is not running on that page yet';
  return null;
})()`);
if (ready) { console.error('\n  ' + ready + '\n'); socket.close(); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
console.log(`\n  Recording ${COUNT} frames into ${OUT}/ — move your feet around, including`);
console.log('  half out of shot, one foot only, and any way it usually goes wrong.\n');

let saved = 0, withFeet = 0;
for (let i = 0; i < COUNT; i++) {
  const shot = await evaluate(`(() => {
    const v = document.getElementById('feed');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return { png: c.toDataURL('image/png'), w: c.width, h: c.height,
             feet: (window.__lastFeet ?? []).map((f) => ({
               side: f.side, box: [f.x0, f.y0, f.x1, f.y1],
               area: f.area, confidence: f.confidence, clipped: f.clipped })) };
  })()`);

  const name = `${stamp}-${String(i).padStart(3, '0')}`;
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({
    image: `${name}.png`, width: shot.w, height: shot.h,
    // "predicted" rather than "boxes", so nobody mistakes these for ground truth.
    predicted: shot.feet,
  }, null, 1));
  saved++;
  if (shot.feet.length) withFeet++;
  process.stdout.write(`\r  ${saved}/${COUNT} frames · ${withFeet} with a foot found`);
  await new Promise((r) => setTimeout(r, EVERY_MS));
}
socket.close();

console.log(`\n\n  ${saved} frames in ${OUT}/`);
console.log(`  ${withFeet} had a foot the detector could find, ${saved - withFeet} did not —`);
console.log('  the ones it missed are the valuable half.\n');
