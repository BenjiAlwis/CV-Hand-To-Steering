/**
 * The centre LCD.
 *
 * A canvas texture redrawn at a fixed 20 Hz — fast enough to read as live
 * instrumentation, cheap enough to leave running. Layout follows the
 * convention drivers actually use: gear dominates, speed and delta flank it,
 * and the setup values sit along the bottom where a glance can find them.
 */
import * as THREE from 'three';

const FONT = '"Arial Narrow", "Helvetica Neue", "Roboto Condensed", Arial, sans-serif';
const W = 768;

export class Display {
  /** @param {{width: number, height: number}} screen the team's panel size */
  constructor(screen) {
    // Match the panel's real aspect so the dash is never stretched when a
    // team runs a different screen.
    const H = Math.round(W * (screen.height / screen.width));
    this.W = W;
    this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });

    this._accum = 0;
    this._interval = 1 / 20;
    this.draw({});
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }

  update(dt, telemetry) {
    this._accum += dt;
    if (this._accum < this._interval) return;
    this._accum = 0;
    this.draw(telemetry);
    this.texture.needsUpdate = true;
  }

  draw(t) {
    const c = this.ctx;
    const { W, H } = this;
    const gear = t.gear ?? 'N';
    const speed = Math.round(t.speed ?? 0);
    const rpm = t.rpm ?? 0;
    const rpmMax = t.rpmMax ?? 15000;
    const delta = t.delta ?? 0;
    const lap = t.lapTime ?? 0;
    const lapNo = t.lap ?? 1;
    const bb = t.brakeBias ?? 56.5;
    const diff = t.diff ?? 9;
    const ers = THREE.MathUtils.clamp(t.ers ?? 0.62, 0, 1);
    const fuel = t.fuel ?? 42.8;
    const mix = t.mix ?? 3;

    c.fillStyle = '#04060a';
    c.fillRect(0, 0, W, H);

    /* ── rpm tape across the top ──────────────────────────────────── */
    const tapeH = H * 0.115, tapeY = H * 0.055, tapeX = W * 0.045, tapeW = W * 0.91;
    c.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(c, tapeX, tapeY, tapeW, tapeH, 3); c.fill();

    const segs = 30;
    const lit = Math.round((rpm / rpmMax) * segs);
    const segW = tapeW / segs;
    for (let i = 0; i < segs; i++) {
      if (i >= lit) continue;
      const f = i / segs;
      const col = f < 0.55 ? '#2fe07a' : f < 0.82 ? '#ffc21f' : '#ff3a2f';
      c.fillStyle = col;
      c.globalAlpha = 0.92;
      c.fillRect(tapeX + i * segW + 1, tapeY + 1.5, segW - 2, tapeH - 3);
    }
    c.globalAlpha = 1;

    /* ── gear ─────────────────────────────────────────────────────── */
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${H * 0.60}px ${FONT}`;
    c.fillText(String(gear), W * 0.50, H * 0.50);

    /* ── speed, left ──────────────────────────────────────────────── */
    c.textAlign = 'left';
    c.fillStyle = '#7d8899';
    c.font = `600 ${H * 0.085}px ${FONT}`;
    c.fillText('KM/H', W * 0.045, H * 0.275);
    c.fillStyle = '#e9eef6';
    c.font = `700 ${H * 0.245}px ${FONT}`;
    c.fillText(String(speed).padStart(3, ' '), W * 0.045, H * 0.415);

    c.fillStyle = '#7d8899';
    c.font = `600 ${H * 0.085}px ${FONT}`;
    c.fillText('LAP', W * 0.045, H * 0.585);
    c.fillStyle = '#e9eef6';
    c.font = `700 ${H * 0.155}px ${FONT}`;
    c.fillText(fmtTime(lap), W * 0.045, H * 0.695);

    /* ── delta, right ─────────────────────────────────────────────── */
    c.textAlign = 'right';
    c.fillStyle = '#7d8899';
    c.font = `600 ${H * 0.085}px ${FONT}`;
    c.fillText('DELTA', W * 0.955, H * 0.275);
    c.fillStyle = delta <= 0 ? '#2fe07a' : '#ff5a4a';
    c.font = `700 ${H * 0.245}px ${FONT}`;
    c.fillText(`${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`, W * 0.955, H * 0.415);

    c.fillStyle = '#7d8899';
    c.font = `600 ${H * 0.085}px ${FONT}`;
    c.fillText(`L${lapNo}`, W * 0.955, H * 0.585);
    c.fillStyle = '#e9eef6';
    c.font = `700 ${H * 0.155}px ${FONT}`;
    c.fillText(`${fuel.toFixed(1)}kg`, W * 0.955, H * 0.695);

    /* ── ers bar ──────────────────────────────────────────────────── */
    const eY = H * 0.795, eH = H * 0.055, eX = W * 0.045, eW = W * 0.91;
    c.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(c, eX, eY, eW, eH, 2); c.fill();
    c.fillStyle = '#4dd4ff';
    roundRect(c, eX, eY, eW * ers, eH, 2); c.fill();

    /* ── setup strip ──────────────────────────────────────────────── */
    const items = [
      ['BB', bb.toFixed(1)],
      ['DIF', String(diff)],
      ['MIX', String(mix)],
      ['ERS', `${Math.round(ers * 100)}%`],
    ];
    c.textBaseline = 'middle';
    const cellW = W * 0.91 / items.length;
    items.forEach(([k, v], i) => {
      const x = W * 0.045 + cellW * i;
      c.textAlign = 'left';
      c.fillStyle = '#5d6878';
      c.font = `600 ${H * 0.085}px ${FONT}`;
      c.fillText(k, x, H * 0.925);
      c.textAlign = 'right';
      c.fillStyle = '#c7d0dd';
      c.font = `700 ${H * 0.105}px ${FONT}`;
      c.fillText(v, x + cellW * 0.82, H * 0.925);
    });

    /* ── panel glow, scanlines ────────────────────────────────────── */
    const glow = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
    glow.addColorStop(0, 'rgba(90,140,200,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    c.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  }
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
