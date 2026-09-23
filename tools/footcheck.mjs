/**
 * Measures what the foot camera can actually see.
 *
 *   npm run footcheck
 *
 * Point the foot camera where you mean to use it, sit as you would to drive,
 * and work the pedals as if they were there. This watches for fifteen seconds
 * and reports what the model made of it.
 *
 * It exists because "the feet do not track" has several different causes that
 * look identical from the outside — nobody found in the picture at all, a
 * person found but their feet out of frame, feet found but held too still to
 * read, or feet found and read perfectly with the pedal mapping at fault —
 * and they need opposite things done about them.
 *
 * Run it against a copy of Wheelhouse that is already open.
 */
import { spawn } from 'node:child_process';

const PORT = 9333;
const SECONDS = Number(process.argv[2] ?? 15);

const ws = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
if (!ws) {
  console.error(`
  Wheelhouse is not open with a debug port.

  Start it with:

      npm start -- --remote-debugging-port=${PORT}

  then run this again.
`);
  process.exit(1);
}

const target = ws.find((t) => t.url?.includes('shell=desktop'));
if (!target) { console.error('  Wheelhouse is open but its window could not be found.'); process.exit(1); }

/** Minimal CDP client — this tool should not drag in a browser automation stack. */
const { WebSocket } = await import('node:worker_threads').then(() => globalThis);
const socket = new (globalThis.WebSocket)(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const fn = pending.get(msg.id);
  if (fn) { pending.delete(msg.id); fn(msg); }
});
await new Promise((r) => socket.addEventListener('open', r));

const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (msg) => {
    if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
    else resolve(msg.result?.result?.value);
  });
  socket.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
});

console.log(`\n  Watching the foot camera for ${SECONDS}s — work the pedals as if they were there.\n`);

const report = await evaluate(`(async () => {
  const t = window.footTracker;
  if (!t) return { error: 'this build has no foot tracker' };
  if (!t.running) return { error: 'the foot camera is not running — check Settings (S)' };

  const samples = [];
  const until = performance.now() + ${SECONDS} * 1000;
  while (performance.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    const L = t.latest;
    samples.push({
      person: !!L?.landmarks,
      rv: L?.right?.visibility ?? 0,
      lv: L?.left?.visibility ?? 0,
      rp: L?.right?.pitch ?? null,
      lp: L?.left?.pitch ?? null,
    });
  }

  const deg = (r) => (r * 180) / Math.PI;
  const stat = (side) => {
    const vis = samples.map((s) => s[side + 'v']);
    const GATE = 0.30;
    const usable = samples.filter((s) => s[side + 'v'] >= GATE);
    // How much would a looser or tighter gate change things? The gate is the
    // one number worth tuning against a real camera rather than guessing at.
    const sweep = {};
    for (const g of [0.25, 0.35, 0.45, 0.55, 0.7]) {
      sweep[g] = Math.round((100 * samples.filter((s) => s[side + 'v'] >= g).length) / samples.length);
    }
    const pitches = usable.map((s) => deg(s[side + 'p'])).filter((n) => Number.isFinite(n));
    return {
      seenPct: Math.round((100 * usable.length) / samples.length),
      medianVis: +vis.sort((a, b) => a - b)[Math.floor(vis.length / 2)].toFixed(2),
      bestVis: +Math.max(...vis).toFixed(2),
      pitchRange: pitches.length > 1
        ? +(Math.max(...pitches) - Math.min(...pitches)).toFixed(1) : null,
      sweep,
    };
  };

  return {
    camera: t.settings ? t.settings.width + 'x' + t.settings.height : 'unknown',
    model: t.modelPath.split('/').pop(),
    detectHz: +(1000 / t.minIntervalMs).toFixed(0),
    inferenceMs: +t.inferenceMs.toFixed(0),
    samples: samples.length,
    personPct: Math.round((100 * samples.filter((s) => s.person).length) / samples.length),
    right: stat('r'),
    left: stat('l'),
  };
})()`);

socket.close();

if (report?.error) { console.error('  ' + report.error + '\n'); process.exit(1); }

const { right, left } = report;
console.log(`  camera ${report.camera} · ${report.model} · ${report.detectHz}Hz · ${report.inferenceMs}ms an inference\n`);
console.log(`  a person was found in           ${String(report.personPct).padStart(3)}% of frames`);
console.log(`  right foot (throttle) usable in ${String(right.seenPct).padStart(3)}% · visibility median ${right.medianVis}, best ${right.bestVis}` +
  (right.pitchRange === null ? '' : ` · pitch swung ${right.pitchRange}°`));
console.log(`  left foot  (brake)    usable in ${String(left.seenPct).padStart(3)}% · visibility median ${left.medianVis}, best ${left.bestVis}` +
  (left.pitchRange === null ? '' : ` · pitch swung ${left.pitchRange}°`));

const gates = [0.25, 0.35, 0.45, 0.55, 0.7];
console.log('\n  usable at each visibility gate (the rig uses 0.30):');
console.log('    gate    ' + gates.map((g) => String(g).padStart(5)).join(''));
console.log('    right   ' + gates.map((g) => `${right.sweep[g]}%`.padStart(5)).join(''));
console.log('    left    ' + gates.map((g) => `${left.sweep[g]}%`.padStart(5)).join(''));

// Both feet have to work, so the verdict goes on the worse of the two. An
// average would call one foot at 100% and the other at 0% a success, which is
// a car with a throttle and no brake.
const worst = Math.min(right.seenPct, left.seenPct);
const swing = Math.min(right.pitchRange ?? 0, left.pitchRange ?? 0);
const lame = right.seenPct < left.seenPct ? 'right' : 'left';
console.log('\n  ' + (
  report.personPct < 40
    ? 'The model is not finding a person at all. It finds feet by finding you,\n  so the camera needs more of you in shot — pull it back until your shins,\n  and ideally your knees, are in the picture.'
    : worst < 40
      ? `Your ${lame} foot is not being seen well enough (${Math.min(right.seenPct, left.seenPct)}% of frames).\n  Angle the camera down, or back, until both feet sit inside the frame with\n  some room around them — and check nothing is cutting one of them off.`
      : worst < 80
        ? `Both feet are found, but the ${lame} one drops out often. Worth nudging the\n  camera until both sit clear of the edges; the rig will cope, but it will\n  feel steadier when they do not come and go.`
        : swing < 8
          ? 'The feet are tracked steadily, but the foot barely changes angle — the pedal\n  movement is not reaching the camera. A more side-on view reads the pivot far\n  better than a head-on one.'
          : 'Both feet are tracked steadily and the movement is getting through. If the\n  pedals still feel wrong, it is the mapping rather than the tracking.'
) + '\n');
