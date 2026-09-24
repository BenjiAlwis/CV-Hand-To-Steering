/**
 * Measures how well the hand tracker copes with gloves.
 *
 *   npm run glovelab <folder-of-images> [label]
 *
 * MediaPipe's hand landmarker is trained overwhelmingly on bare hands, and a
 * gloved hand is a different object: no knuckle creases, no nail edges, no
 * skin tone, and a silhouette fattened by a few millimetres of leather. The
 * question is not whether that costs anything but how much, so this runs the
 * real tracker over a folder of real photographs and counts.
 *
 * Bare hands from the same source are the control. Without one, a low number
 * says nothing — it might be the pictures rather than the gloves.
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const DIR = process.argv[2];
const LABEL = process.argv[3] ?? path.basename(DIR);
if (!DIR) { console.error('\n  usage: npm run glovelab <folder> [label]\n'); process.exit(1); }

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
if (!list) {
  console.error(`\n  Wheelhouse is not open with a debug port. Start it with:\n\n      npm start -- --remote-debugging-port=${PORT}\n`);
  process.exit(1);
}
const target = list.find((t) => t.url?.includes('127.0.0.1'));
const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  const fn = pending.get(m.id);
  if (fn) { pending.delete(m.id); fn(m); }
});
await new Promise((r) => socket.addEventListener('open', r));
const evaluate = (expression, ms = 120000) => new Promise((res, rej) => {
  const id = nextId++;
  const timer = setTimeout(() => rej(new Error('timed out')), ms);
  pending.set(id, (m) => {
    clearTimeout(timer);
    if (m.result?.exceptionDetails) rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)));
    else res(m.result?.result?.value);
  });
  socket.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
});

// One landmarker per confidence setting, so the sweep is over the knob that
// actually decides whether a marginal hand is kept or thrown away.
await evaluate(`(async () => {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
  window.__lm = {};
  for (const c of [0.5, 0.35, 0.2, 0.1]) {
    window.__lm[c] = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/assets/models/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'IMAGE', numHands: 2,
      minHandDetectionConfidence: c, minHandPresenceConfidence: c, minTrackingConfidence: c,
    });
  }
  return 'ready';
})()`);

// The annotations say where the gloves are, which lets the same picture be
// tried whole and again cropped to the glove and blown up. A landmark model
// given a hand that fills the frame is being asked a much easier question
// than one given a hand forty pixels across in the corner.
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const files = fs.readdirSync(path.join(DIR, 'images')).filter((f) => /\.(jpg|png)$/i.test(f));
const thresholds = [0.5, 0.35, 0.2, 0.1];
const found = Object.fromEntries(thresholds.map((t) => [t, 0]));
const hands = Object.fromEntries(thresholds.map((t) => [t, 0]));
const cropFound = Object.fromEntries(thresholds.map((t) => [t, 0]));
const prep = { plain: 0, contrast: 0, gamma: 0, grey: 0, sharp: 0 };
let cropBoxes = 0;
let scored = 0;

for (const file of files) {
  const b64 = fs.readFileSync(path.join(DIR, 'images', file)).toString('base64');
  let result;
  try {
    // The image goes over on its own, away from the expression, so a large
    // photograph cannot blow the size limit on the evaluate.
    await evaluate(`(async () => {
      const i = new Image(); i.src = 'data:image/jpeg;base64,${b64}';
      await i.decode();
      const c = document.createElement('canvas');
      const k = Math.min(1, 640 / Math.max(i.width, i.height));
      c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
      window.__img = c; return 1;
    })()`);
    result = await evaluate(`JSON.stringify(Object.fromEntries(
      [0.5, 0.35, 0.2, 0.1].map((t) => [t, (window.__lm[t].detect(window.__img).landmarks ?? []).length])))`);

    // Does making the picture easier to read help? A glove has none of the
    // creases and nail edges the model leans on, so the guess worth testing
    // is that lifting local contrast puts some structure back.
    const pre = await evaluate(`(() => {
      const src = window.__img, W = src.width, H = src.height;
      const lm = window.__lm[0.2];
      const run = (draw) => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        draw(x);
        return (lm.detect(c).landmarks ?? []).length > 0 ? 1 : 0;
      };
      return JSON.stringify({
        plain: run((x) => x.drawImage(src, 0, 0)),
        contrast: run((x) => { x.filter = 'contrast(1.6) brightness(1.05)'; x.drawImage(src, 0, 0); }),
        gamma: run((x) => { x.filter = 'brightness(1.35) saturate(0.6)'; x.drawImage(src, 0, 0); }),
        grey: run((x) => { x.filter = 'grayscale(1) contrast(1.4)'; x.drawImage(src, 0, 0); }),
        sharp: run((x) => {
          x.filter = 'contrast(1.25)'; x.drawImage(src, 0, 0);
          x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.35;
          x.filter = 'blur(2px) invert(1)'; x.drawImage(src, 0, 0);
        }),
      });
    })()`);
    const p = JSON.parse(pre);
    for (const k of Object.keys(prep)) prep[k] += p[k];

    // And again, cropped to each annotated box and scaled up to 320px.
    const boxes = (labels.images[path.parse(file).name] ?? []).map((b) => b.box);
    if (boxes.length) {
      const cropped = await evaluate(`(() => {
        const src = window.__img, W = src.width, H = src.height;
        const out = {};
        for (const t of [0.5, 0.35, 0.2, 0.1]) out[t] = 0;
        for (const b of ${JSON.stringify(boxes)}) {
          const pad = 0.18;
          const bw = (b[2] - b[0]) * W, bh = (b[3] - b[1]) * H;
          const x = Math.max(0, b[0] * W - bw * pad), y = Math.max(0, b[1] * H - bh * pad);
          const w = Math.min(W - x, bw * (1 + 2 * pad)), h = Math.min(H - y, bh * (1 + 2 * pad));
          if (w < 8 || h < 8) continue;
          const c = document.createElement('canvas');
          const k = 320 / Math.max(w, h);
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
          for (const t of [0.5, 0.35, 0.2, 0.1]) {
            if ((window.__lm[t].detect(c).landmarks ?? []).length > 0) out[t]++;
          }
        }
        return JSON.stringify(out);
      })()`);
      const c = JSON.parse(cropped);
      cropBoxes += boxes.length;
      for (const t of thresholds) cropFound[t] += c[t];
    }
  } catch {
    continue;
  }
  const counts = JSON.parse(result);
  scored++;
  for (const t of thresholds) {
    if (counts[t] > 0) found[t]++;
    hands[t] += counts[t];
  }
  if (scored % 25 === 0) process.stdout.write(`\r  ${scored}/${files.length}`);
}
socket.close();

console.log(`\r  ${LABEL}: ${scored} images\n`);
console.log('  confidence   images with a hand found   hands found');
for (const t of thresholds) {
  const pct = ((100 * found[t]) / Math.max(1, scored)).toFixed(0);
  console.log(`  ${String(t).padEnd(12)} ${String(found[t]).padStart(4)}/${scored}  (${pct.padStart(3)}%)           ${hands[t]}`);
}
console.log('\n  preprocessing, at 0.2 confidence:\n');
for (const [name, hit] of Object.entries(prep)) {
  const pct = ((100 * hit) / Math.max(1, scored)).toFixed(0);
  console.log(`  ${name.padEnd(12)} ${String(hit).padStart(4)}/${scored}  (${pct.padStart(3)}%)`);
}

if (cropBoxes) {
  console.log(`\n  and again, cropped to each annotated box and scaled to 320px (${cropBoxes} boxes):\n`);
  console.log('  confidence   boxes where a hand was found');
  for (const t of thresholds) {
    const pct = ((100 * cropFound[t]) / cropBoxes).toFixed(0);
    console.log(`  ${String(t).padEnd(12)} ${String(cropFound[t]).padStart(4)}/${cropBoxes}  (${pct.padStart(3)}%)`);
  }
}
console.log('');
