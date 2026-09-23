/**
 * The standalone foot detector page.
 *
 * Deliberately not wired into the rig: this is for looking at what the
 * detector sees on a real camera, on its own, with nothing else running that
 * could be blamed for the result.
 */
import { FootDetector } from './footdetector.js';
import { isClipped } from './blobs.js';

const feed = document.getElementById('feed');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const out = document.getElementById('out');
const pick = document.getElementById('camera');
const modelPick = document.getElementById('model');
const socks = document.getElementById('socks');
const showMask = document.getElementById('showMask');
const startButton = document.getElementById('start');

let detector = null;
let stream = null;
let running = false;
let stamp = 0;
let fps = 0, frames = 0, fpsAt = performance.now();

const say = (text, bad = false) => { out.textContent = text; out.classList.toggle('err', bad); };

async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  pick.innerHTML = '';
  for (const [i, c] of cameras.entries()) {
    pick.append(new Option(c.label || `camera ${i + 1}`, c.deviceId));
  }
  // The foot camera is usually the second one, and usually the phone.
  const phone = cameras.find((c) => /iphone|phone|continuity|usb/i.test(c.label));
  if (phone) pick.value = phone.deviceId;
  else if (cameras[1]) pick.value = cameras[1].deviceId;
  return cameras;
}

async function start() {
  if (running) { stop(); return; }
  try {
    say('opening the camera…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: pick.value ? { exact: pick.value } : undefined,
               height: { ideal: 720 }, frameRate: { ideal: 30 }, resizeMode: 'none' },
      audio: false,
    });
    feed.srcObject = stream;
    await feed.play();
    // Labels only arrive once permission is held, so the list is worth redoing.
    await listCameras();

    say('loading the segmenter…');
    detector?.close();
    detector = new FootDetector({ model: modelPick.value, socks: socks.checked });
    await detector.load();

    running = true;
    startButton.textContent = 'Stop';
    // Reachable from the console and from the recording tools.
    window.__detector = detector;
    window.__feed = feed;
    loop();
  } catch (error) {
    say(`${error.name}: ${error.message}`, true);
    stop();
  }
}

function stop() {
  running = false;
  startButton.textContent = 'Start';
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  feed.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function loop() {
  if (!running) return;
  if (feed.readyState >= 2) {
    stamp = Math.max(stamp + 1, performance.now());
    let result = null;
    try { result = detector.detect(feed, stamp); } catch (e) { say(String(e), true); }
    if (result) draw(result);
  }
  requestAnimationFrame(loop);
}

function draw({ feet, blobs, mask }) {
  // Left where a recorder can pick them up as pre-labels for a dataset.
  window.__lastFeet = feet;

  const w = overlay.width = overlay.clientWidth;
  const h = overlay.height = overlay.clientHeight;
  ctx.clearRect(0, 0, w, h);

  // Mirrored to match the feed, which is mirrored so it reads like a mirror.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  if (showMask.checked && mask) {
    const m = document.createElement('canvas');
    m.width = mask.width; m.height = mask.height;
    const id = m.getContext('2d').createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      if (!mask.data[i]) continue;
      id.data[i * 4] = 47; id.data[i * 4 + 1] = 224; id.data[i * 4 + 2] = 122;
      id.data[i * 4 + 3] = 90;
    }
    m.getContext('2d').putImageData(id, 0, 0);
    ctx.drawImage(m, 0, 0, w, h);
  }

  for (const foot of feet) {
    const x = foot.x0 * w, y = foot.y0 * h;
    const bw = (foot.x1 - foot.x0) * w, bh = (foot.y1 - foot.y0) * h;
    const clipped = isClipped(foot);
    ctx.lineWidth = 2.5;
    ctx.setLineDash(clipped ? [7, 5] : []);
    ctx.strokeStyle = foot.side === 'right' ? '#2fe07a' : foot.side === 'left' ? '#ff6a3d' : '#4dd4ff';
    ctx.strokeRect(x, y, bw, bh);
    ctx.setLineDash([]);

    // Labels read left to right, so they are drawn outside the mirror.
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    const lx = w - x - bw;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '600 12px ui-monospace, monospace';
    const tag = `${foot.side ?? 'foot'} ${Math.round(foot.confidence * 100)}%${clipped ? ' · cut off' : ''}`;
    ctx.fillText(tag, lx, Math.max(13, y - 5));
    ctx.restore();
  }
  ctx.restore();

  frames++;
  const since = performance.now() - fpsAt;
  if (since > 500) { fps = Math.round((frames * 1000) / since); frames = 0; fpsAt = performance.now(); }

  const lines = [
    `${feed.videoWidth}×${feed.videoHeight} → ${mask ? `${mask.width}×${mask.height}` : '—'} · ` +
    `${fps}fps · ${detector.inferenceMs.toFixed(0)}ms · ${blobs.length} region${blobs.length === 1 ? '' : 's'}`,
  ];
  if (!feet.length) lines.push('no feet found — try the socks option if they are covered');
  for (const f of feet) {
    lines.push(`  ${(f.side ?? 'unnamed').padEnd(7)} ` +
      `box ${f.x0.toFixed(2)},${f.y0.toFixed(2)} → ${f.x1.toFixed(2)},${f.y1.toFixed(2)} · ` +
      `${(f.area * 100).toFixed(1)}% of frame · ${Math.round(f.confidence * 100)}%` +
      (isClipped(f) ? ` · runs off ${Object.entries(f.clipped).filter(([, v]) => v).map(([k]) => k).join(' and ')}` : ''));
  }
  say(lines.join('\n'));
}

for (const el of [modelPick, socks]) {
  el.addEventListener('change', () => { if (running) { stop(); start(); } });
}
startButton.addEventListener('click', start);
listCameras().then(() => say('pick a camera and press start'));
