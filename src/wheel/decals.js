/**
 * Small printed details: the legends on button caps, and the numbers round a
 * thumb roller.
 *
 * Real wheels print a control's name on the control itself as often as next
 * to it — every Mercedes button carries its own legend, and its rollers have
 * their positions printed round the drum. Drawn here as canvas textures, so
 * they share the faceplate's typeface and stay crisp up close.
 */
import * as THREE from 'three';

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** One texture per distinct legend: a wheel repeats few of them. */
const cache = new Map();

/**
 * A cap's legend on a transparent square: text, or one of the icons drivers
 * actually see — a cross for cancel, a handset for the radio.
 *
 * @param {string} label
 * @param {string} ink  CSS colour that reads on the cap
 */
export function capLegendTexture(label, ink, split = null) {
  const key = `${label}|${ink}|${split ?? ''}`;
  const inkOf = (i) => (Array.isArray(ink) ? ink[i % ink.length] : ink);
  if (cache.has(key)) return cache.get(key);

  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  // A cap moulded in two colours (Ferrari's 1+ and 10−): the crown split
  // across the middle, the top half in the first colour.
  if (split) {
    const R = size * 0.5;
    split.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(size / 2, size / 2, R, Math.PI + i * Math.PI, Math.PI * 2 + i * Math.PI);
      g.closePath();
      g.fill();
    });
  }
  g.fillStyle = inkOf(0);
  g.strokeStyle = inkOf(0);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  if (label === '@cancel') {
    // Cancel: a heavy white cross.
    g.lineWidth = size * 0.11;
    g.lineCap = 'round';
    const k = size * 0.2;
    g.beginPath();
    g.moveTo(size / 2 - k, size / 2 - k); g.lineTo(size / 2 + k, size / 2 + k);
    g.moveTo(size / 2 + k, size / 2 - k); g.lineTo(size / 2 - k, size / 2 + k);
    g.stroke();
  } else if (label === '@radio') {
    // A handset in a ring.
    g.lineWidth = size * 0.05;
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.27, 0, Math.PI * 2); g.stroke();
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(-Math.PI / 4);
    g.lineWidth = size * 0.085;
    g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, size * 0.13, Math.PI * 0.35, Math.PI * 1.65); g.stroke();
    g.restore();
  } else {
    // Text, two lines if it carries one ("MARK\nPC"), as large as fits.
    const lines = label.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    const px = Math.min(size * 0.42, (size * 0.86) / Math.max(1, longest * 0.62)) / (lines.length > 1 ? 1.35 : 1);
    g.font = `800 ${px}px ${FONT}`;
    lines.forEach((line, i) => {
      const y = size / 2 + (i - (lines.length - 1) / 2) * px * 1.05;
      g.fillStyle = inkOf(i);
      g.fillText(line, size / 2, y);
    });
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/** Ferrari's prancing horse, as the black silhouette printed on its badges. */
const HORSE_URL = '/assets/logos/prancing-horse.svg';

/**
 * The crown of Ferrari's centre rotary: a yellow disc carrying the black
 * prancing horse, with a red triangle above it marking the pointer.
 *
 * The horse is an SVG loaded on demand, so the badge is drawn at once and
 * the horse painted in when it arrives; if it cannot be loaded, a knight's
 * head stands in for it.
 */
export function emblemTexture(colour = '#f6d21c') {
  const key = `emblem|${colour}`;
  if (cache.has(key)) return cache.get(key);
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const base = () => {
    g.clearRect(0, 0, size, size);
    g.fillStyle = colour;
    g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0261c';
    g.beginPath();
    g.moveTo(size / 2, size * 0.055); g.lineTo(size / 2 + size * 0.07, size * 0.17); g.lineTo(size / 2 - size * 0.07, size * 0.17);
    g.closePath(); g.fill();
  };
  base();

  const img = new Image();
  img.onload = () => {
    base();
    // The horse fills most of the badge below the triangle: about two
    // thirds of its height, in the artwork's own proportions (162 × 224).
    const h = size * 0.68;
    const w = h * (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 162 / 224);
    g.drawImage(img, (size - w) / 2, size * 0.205, w, h);
    tex.needsUpdate = true;
  };
  img.onerror = () => {
    g.fillStyle = '#111111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${size * 0.56}px "DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", serif`;
    g.fillText('\u265E', size / 2, size * 0.56);
    tex.needsUpdate = true;
  };
  img.src = HORSE_URL;

  cache.set(key, tex);
  return tex;
}

/**
 * Text across a small raised tab — Ferrari's BS and TRQ blocks: white,
 * heavy, filling the tab's height.
 *
 * @param {number} aspect the tab's width / height
 */
export function tabTextTexture(text, ink, aspect, { fill = false } = {}) {
  const key = `tab|${text}|${ink}|${aspect.toFixed(2)}|${fill}`;
  if (cache.has(key)) return cache.get(key);
  const H = 128, W = Math.round(H * aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = H * 0.62;
  g.font = `900 ${px}px ${FONT}`;
  const w = g.measureText(text).width;
  if (w > W * 0.86) { px *= (W * 0.86) / w; g.font = `900 ${px}px ${FONT}`; }
  if (fill && w < W * 0.86) {
    // An extended wordmark: the letters stretched to the full width, as a
    // logo's are drawn, rather than set at their natural width.
    g.save();
    g.translate(W / 2, 0);
    g.scale((W * 0.9) / w, 1);
    g.fillText(text, 0, H * 0.54);
    g.restore();
  } else {
    g.fillText(text, W / 2, H * 0.54);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/**
 * A word printed with its letters stacked one above another — how Red Bull
 * names the rollers on its pods ("B B A L" down the side of the drum) —
 * optionally inside a thin rounded box.
 *
 * @returns {{ texture: THREE.CanvasTexture, aspect: number }} aspect is width / height
 */
export function stackedLabelTexture(text, ink, { box = false } = {}) {
  const key = `stack|${text}|${ink}|${box}`;
  if (cache.has(key)) return cache.get(key);
  const letters = [...text.replace(/ /g, '')];
  const cell = 64;
  const W = cell, H = cell * letters.length + (box ? cell * 0.5 : 0);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${cell * 0.78}px ${FONT}`;
  const top = box ? cell * 0.25 : 0;
  letters.forEach((ch, i) => g.fillText(ch, W / 2, top + cell * (i + 0.53)));
  if (box) {
    g.lineWidth = cell * 0.06;
    const r = cell * 0.3, x = cell * 0.06, y = cell * 0.06, w = W - cell * 0.12, h = H - cell * 0.12;
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const out = { texture: tex, aspect: W / H };
  cache.set(key, out);
  return out;
}

/**
 * The surface of a thumb roller, unwrapped: its base colour, ridges running
 * along the drum for grip, and its positions printed round it.
 *
 * Mapped onto a cylinder, u runs round the drum and v along it.
 *
 * @param {number} base  the drum's colour
 * @param {number[]} numbers  printed round the circumference, or empty
 * @param {string} ink
 */
export function rollerTexture(base, numbers, ink, turn = Math.PI / 2) {
  const key = `roller|${base}|${numbers.join(',')}|${ink}|${turn.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, W, H);

  // Ridges: alternate light and dark bands round the drum.
  const ridges = Math.max(24, numbers.length * 4);
  for (let i = 0; i < ridges; i++) {
    const x = (i / ridges) * W;
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.10)';
    g.fillRect(x, 0, W / ridges * 0.5, H);
  }

  if (numbers.length) {
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Each number gets its share of the circumference; any taller and the
    // neighbours print over each other.
    g.font = `800 ${Math.min(H * 0.62, (W / numbers.length) * 0.72)}px ${FONT}`;
    numbers.forEach((n, i) => {
      // Mapped onto the drum, the canvas's x runs up the visible face and
      // its y across it; numbers count downwards, as printed on the cars.
      const x = (1 - (i + 0.5) / numbers.length) * W;
      g.save();
      g.translate(x, H / 2);
      // A quarter turn stands the glyphs upright on a drum whose axle runs
      // across the face; `turn` adds the drum's own angle back out.
      g.rotate(turn);
      g.fillText(String(n), 0, 0);
      g.restore();
    });
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/**
 * A rounded star in the plane: the scalloped, pointed outline of Mercedes'
 * rotary knobs, so the grip shows in silhouette.
 */
export function knobShape(radius, lobes = 8, depth = 0.12) {
  const shape = new THREE.Shape();
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * (1 - depth / 2 + (depth / 2) * Math.cos(lobes * a));
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return shape;
}
