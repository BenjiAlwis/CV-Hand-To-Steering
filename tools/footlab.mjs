/**
 * A bench for the foot camera's computer vision.
 *
 *   npm run footlab [frames] [outDir]
 *
 * Grabs real frames from the foot camera, then runs the pose graph over them
 * every way it can be run — both model sizes, all four rotations, the whole
 * frame and an upright centre crop — and reports which combination actually
 * finds the feet. It writes the frames out too, because a number cannot tell
 * you the camera is pointing at a wall and a picture can.
 *
 * Orientation is in the sweep because it is the failure nobody suspects: the
 * pose graph is trained on upright people, and a phone lying on its side to
 * watch a pair of feet hands it a person rotated ninety degrees. Detection
 * does not degrade gracefully when that happens, it stops.
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const FRAMES = Number(process.argv[2] ?? 6);
const OUT = process.argv[3] ?? 'footlab';

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
if (!list) {
  console.error(`\n  Wheelhouse is not open with a debug port. Start it with:\n\n      npm start -- --remote-debugging-port=${PORT}\n`);
  process.exit(1);
}
const target = list.find((t) => t.url?.includes('shell=desktop'));
if (!target) { console.error('  Wheelhouse is open but its window could not be found.'); process.exit(1); }

const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  const fn = pending.get(msg.id);
  if (fn) { pending.delete(msg.id); fn(msg); }
});
await new Promise((r) => socket.addEventListener('open', r));

const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (msg) => {
    if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 400)));
    else resolve(msg.result?.result?.value);
  });
  socket.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
});

console.log(`\n  Grabbing ${FRAMES} frames from the foot camera and sweeping the pose graph over them.`);
console.log('  Sit as you would to drive and work the pedals — this takes a minute.\n');

const result = await evaluate(`(async () => {
  const video = document.getElementById('footFeed');
  const t = window.footTracker;
  if (!t?.running) return { error: 'the foot camera is not running — check Settings (S)' };
  if (!video || video.readyState < 2) return { error: 'the foot camera has no picture yet' };

  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');

  const make = (model) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/assets/models/pose_landmarker_' + model + '.task', delegate: 'GPU' },
    runningMode: 'IMAGE', numPoses: 1,
    minPoseDetectionConfidence: 0.15,
    minPosePresenceConfidence: 0.15,
    minTrackingConfidence: 0.15,
  });
  const models = { lite: await make('lite'), full: await make('full') };

  // Grab the frames first, spread out, so every variant sees the same pictures.
  const grabs = [];
  const cap = document.createElement('canvas');
  const cx = cap.getContext('2d');
  for (let i = 0; i < ${FRAMES}; i++) {
    cap.width = video.videoWidth; cap.height = video.videoHeight;
    cx.drawImage(video, 0, 0);
    grabs.push({ png: cap.toDataURL('image/png'), w: cap.width, h: cap.height });
    await new Promise((r) => setTimeout(r, 700));
  }

  // Redraw a grab under some transform, and hand back a canvas to detect on.
  const work = document.createElement('canvas');
  const wx = work.getContext('2d');
  const render = async (grab, rotation, crop, pad) => {
    const img = new Image();
    img.src = grab.png;
    await img.decode();
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (crop) { sw = img.width * 0.6; sh = img.height * 0.6; sx = (img.width - sw) / 2; sy = (img.height - sh) / 2; }
    const swap = rotation === 90 || rotation === 270;
    work.width = swap ? sh : sw;
    work.height = swap ? sw : sh;
    wx.save();
    // Padding shrinks the subject inside the frame. Worth trying because a
    // foot filling the picture is nothing like the framing the detector was
    // trained on, and it costs one drawImage to find out.
    wx.fillStyle = '#7f7f7f';
    wx.fillRect(0, 0, work.width, work.height);
    wx.translate(work.width / 2, work.height / 2);
    wx.rotate((rotation * Math.PI) / 180);
    const k = pad ? 0.5 : 1;
    wx.drawImage(img, sx, sy, sw, sh, (-sw / 2) * k, (-sh / 2) * k, sw * k, sh * k);
    wx.restore();
    return work;
  };

  const V = (lm, i) => (lm?.[i]?.visibility ?? 0);
  const rows = [];
  for (const model of ['lite', 'full']) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const [crop, pad] of [[false, false], [true, false], [false, true]]) {
        let person = 0, rSum = 0, lSum = 0, rBest = 0, lBest = 0;
        for (const grab of grabs) {
          const canvas = await render(grab, rotation, crop, pad);
          let lm = null;
          try { lm = models[model].detect(canvas)?.landmarks?.[0] ?? null; } catch (e) { /* skip */ }
          if (!lm) continue;
          person++;
          // right ankle/heel/toe = 28/30/32, left = 27/29/31
          const r = Math.min(V(lm, 28), V(lm, 30), V(lm, 32));
          const l = Math.min(V(lm, 27), V(lm, 29), V(lm, 31));
          rSum += r; lSum += l; rBest = Math.max(rBest, r); lBest = Math.max(lBest, l);
        }
        rows.push({
          model, rotation, crop, pad,
          personPct: Math.round((100 * person) / grabs.length),
          rAvg: +(person ? rSum / person : 0).toFixed(2),
          lAvg: +(person ? lSum / person : 0).toFixed(2),
          rBest: +rBest.toFixed(2), lBest: +lBest.toFixed(2),
        });
      }
    }
  }
  for (const m of Object.values(models)) m.close?.();
  return { frames: grabs.map((g) => g.png), size: grabs[0].w + 'x' + grabs[0].h, rows };
})()`);

socket.close();

if (result?.error) { console.error('\n  ' + result.error + '\n'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
result.frames.forEach((png, i) => {
  fs.writeFileSync(path.join(OUT, `frame-${i}.png`), Buffer.from(png.split(',')[1], 'base64'));
});

// Worst foot first: both have to work, and an average hides one at zero.
const scored = result.rows
  .map((r) => ({ ...r, worst: Math.min(r.rAvg, r.lAvg) }))
  .sort((a, b) => b.worst - a.worst);

console.log(`  frames ${result.size}, written to ${OUT}/\n`);
console.log('  model  rotation  framing person   right  left   worst');
for (const r of scored.slice(0, 10)) {
  console.log(`  ${r.model.padEnd(6)} ${String(r.rotation + '°').padEnd(9)} ${(r.crop ? 'centre' : 'full').padEnd(6)} ` +
    `${String(r.personPct + '%').padStart(5)}    ${r.rAvg.toFixed(2)}  ${r.lAvg.toFixed(2)}   ${r.worst.toFixed(2)}`);
}
const best = scored[0];
const GATE = 0.30;
console.log(`\n  best: ${best.model} at ${best.rotation}° on the ${best.crop ? 'centre crop' : best.pad ? 'zoomed-out frame' : 'full frame'} ` +
  `— worst foot ${best.worst.toFixed(2)}`);

if (best.worst < GATE) {
  // Ranking noise is not a finding. When nothing clears the gate, the order
  // of the table is meaningless and saying which variant "won" would send
  // someone off tuning a knob that cannot help them.
  console.log(`\n  Nothing clears the ${GATE} the rig needs, so the ordering above is noise\n` +
    '  rather than a result. No model, rotation or crop rescues this camera\n' +
    '  position — it has to move. The pose graph finds feet by finding a person,\n' +
    '  so it needs to see enough of you to know you are one: both feet in frame\n' +
    '  with room around them, shins in shot, and the camera far enough back that\n' +
    "  a foot is not filling the picture. Look at the frames in the output folder —\n" +
    '  if you cannot see both feet and some leg, neither can the model.\n');
} else {
  const upright = scored.find((r) => r.rotation === 0 && !r.crop && !r.pad && r.model === 'full');
  if (best.rotation !== 0 && best.worst > (upright?.worst ?? 0) + 0.15) {
    console.log(`  The picture looks rotated: turning it ${best.rotation}° lifts the worst foot\n` +
      `  from ${(upright?.worst ?? 0).toFixed(2)} to ${best.worst.toFixed(2)}. Worth re-running to confirm before trusting it.\n`);
  } else {
    console.log('');
  }
}
