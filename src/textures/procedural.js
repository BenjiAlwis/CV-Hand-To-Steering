/**
 * Procedural material lab.
 *
 * Everything the wheel is made of is synthesised here at runtime — 2x2 twill
 * carbon, Alcantara suede, anodised aluminium, knurled dial flanks — so the
 * project ships with zero binary assets and every surface stays resolution
 * independent.
 */
import * as THREE from 'three';

/* ───────────────────────────── helpers ───────────────────────────── */

export function createCanvas(w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

/** Small, fast, seedable PRNG so every build of the wheel looks identical. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tiling value noise — the base layer for every organic surface here. */
export function makeValueNoise(seed = 1, period = 64) {
  const rand = mulberry32(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const at = (x, y) => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)];

  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
  };
}

export function makeFbm(seed = 1, octaves = 5, period = 64) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeValueNoise(seed + o * 131, period));
  return function fbm(x, y) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += layers[o](x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

/**
 * Sobel-derives a tangent-space normal map from a greyscale height canvas.
 * Wrapping is enabled so tiling surfaces stay seamless across the edge.
 */
export function normalMapFromHeight(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const { canvas, ctx } = createCanvas(w, h);
  const out = ctx.createImageData(w, h);

  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = H(x - 1, y - 1), t = H(x, y - 1), tr = H(x + 1, y - 1);
      const l = H(x - 1, y), r = H(x + 1, y);
      const bl = H(x - 1, y + 1), b = H(x, y + 1), br = H(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * w + x) * 4;
      out.data[i]     = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Wraps a canvas as a repeating colour texture. */
export function colorTexture(canvas, repeat = 1, aniso = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

/** Wraps a canvas as a repeating linear (data) texture — normals, roughness. */
export function dataTexture(canvas, repeat = 1, aniso = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

/* ─────────────────────────── carbon fibre ─────────────────────────── */

/**
 * 2x2 twill weave — the pattern used for F1 bodywork and wheel faceplates.
 *
 * Each cell holds one tow segment. In a 2/2 twill the warp floats over two
 * wefts then under two, stepping one cell per row, which is what produces the
 * signature diagonal ribbing. Tows are shaded with a perpendicular gradient so
 * they read as rounded bundles, then streaked along their length with
 * individual filaments.
 */
export function carbonWeave({
  size = 1024,
  cells = 24,
  seed = 7,
  base = [14, 16, 21],
  peak = [96, 104, 122],
  fibres = 9,
} = {}) {
  const { canvas: col, ctx: c } = createCanvas(size);
  const { canvas: hgt, ctx: h } = createCanvas(size);
  const rand = mulberry32(seed);
  const cell = size / cells;

  c.fillStyle = `rgb(${base[0] * 0.55 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`;
  c.fillRect(0, 0, size, size);
  h.fillStyle = '#3a3a3a';
  h.fillRect(0, 0, size, size);

  const tow = (x, y, w, hh, vertical, lift) => {
    // Cylindrical shading across the tow's short axis.
    const g = vertical
      ? c.createLinearGradient(x, 0, x + w, 0)
      : c.createLinearGradient(0, y, 0, y + hh);
    const shade = (t) => {
      // t: 0..1 across the tow. Brightest slightly off-centre for a lit look.
      const k = Math.pow(Math.sin(Math.PI * t), 0.75);
      const mix = k * lift;
      return `rgb(${(base[0] + (peak[0] - base[0]) * mix) | 0},${(base[1] + (peak[1] - base[1]) * mix) | 0},${(base[2] + (peak[2] - base[2]) * mix) | 0})`;
    };
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, shade(i / 8));
    c.fillStyle = g;
    c.fillRect(x, y, w, hh);

    const gh = vertical
      ? h.createLinearGradient(x, 0, x + w, 0)
      : h.createLinearGradient(0, y, 0, y + hh);
    for (let i = 0; i <= 8; i++) {
      const v = (0.30 + 0.70 * Math.pow(Math.sin(Math.PI * (i / 8)), 0.8)) * lift;
      const b = (v * 255) | 0;
      gh.addColorStop(i / 8, `rgb(${b},${b},${b})`);
    }
    h.fillStyle = gh;
    h.fillRect(x, y, w, hh);

    // Individual filaments running the length of the tow.
    c.save();
    c.globalCompositeOperation = 'overlay';
    for (let f = 0; f < fibres; f++) {
      const t = (f + 0.5) / fibres;
      const a = 0.10 + rand() * 0.20;
      c.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.3})`;
      c.lineWidth = Math.max(0.6, cell * 0.035);
      c.beginPath();
      if (vertical) { c.moveTo(x + w * t, y); c.lineTo(x + w * t, y + hh); }
      else { c.moveTo(x, y + hh * t); c.lineTo(x + w, y + hh * t); }
      c.stroke();
    }
    c.restore();
  };

  // Under-tows first: a full grid of dim yarns, which is what shows in the
  // gaps between the floats on top.
  for (let i = 0; i < cells; i++) tow(i * cell, 0, cell, size, true, 0.40);
  for (let j = 0; j < cells; j++) tow(0, j * cell, size, cell, false, 0.44);

  // Then the floats. In a 2/2 twill each yarn passes over two and under two,
  // stepping one cell per row — so a float is two cells long, and drawing it
  // as one continuous run is what produces the diagonal rib. Drawing each
  // cell separately (the obvious way) gives a basket weave instead.
  const mod4 = (i, j) => (((i - j) % 4) + 4) % 4;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const m = mod4(i, j);
      if (m === 1) {
        // Warp float over two wefts, running down the column.
        const x = i * cell, y = j * cell;
        tow(x + cell * 0.045, y, cell * 0.91, cell * 2, true, 1.0);
        if (j + 2 > cells) tow(x + cell * 0.045, y - size, cell * 0.91, cell * 2, true, 1.0);
      } else if (m === 2) {
        // Weft float over two warps, running across the row.
        const x = i * cell, y = j * cell;
        tow(x, y + cell * 0.045, cell * 2, cell * 0.91, false, 0.88);
        if (i + 2 > cells) tow(x - size, y + cell * 0.045, cell * 2, cell * 0.91, false, 0.88);
      }
    }
  }

  // Resin layer: broad, slow variation in gloss + a faint blue-grey cast.
  const fbm = makeFbm(seed + 41, 4, 32);
  const img = c.getImageData(0, 0, size, size);
  const rough = createCanvas(size);
  const rimg = rough.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 6, (y / size) * 6);
      const i = (y * size + x) * 4;
      img.data[i]     = Math.min(255, img.data[i] * (0.88 + n * 0.3));
      img.data[i + 1] = Math.min(255, img.data[i + 1] * (0.88 + n * 0.3));
      img.data[i + 2] = Math.min(255, img.data[i + 2] * (0.90 + n * 0.3));
      const rv = (0.30 + n * 0.26) * 255;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rv | 0;
      rimg.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  rough.ctx.putImageData(rimg, 0, 0);

  return { color: col, height: hgt, roughness: rough.canvas };
}

/* ───────────────────────────── alcantara ──────────────────────────── */

/**
 * Suede / Alcantara: a dense mat of short microfibres. Built as thousands of
 * tiny strokes with random orientation, which gives both the velvety colour
 * break-up and the high-frequency normal detail that catches grazing light.
 */
export function alcantara({ size = 1024, seed = 19, tint = [26, 27, 31], strokes = 26000 } = {}) {
  const { canvas: col, ctx: c } = createCanvas(size);
  const { canvas: hgt, ctx: h } = createCanvas(size);
  const rand = mulberry32(seed);

  c.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  c.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);

  // Broad nap variation — the directional sheen suede shows when brushed.
  const fbm = makeFbm(seed + 3, 4, 32);
  const img = c.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 4, (y / size) * 4);
      const i = (y * size + x) * 4;
      const k = 0.72 + n * 0.56;
      img.data[i] = tint[0] * k; img.data[i + 1] = tint[1] * k; img.data[i + 2] = tint[2] * k;
    }
  }
  c.putImageData(img, 0, 0);

  c.lineCap = 'round'; h.lineCap = 'round';
  for (let s = 0; s < strokes; s++) {
    const x = rand() * size, y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 1.5 + rand() * 4.5;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const bright = rand();

    c.strokeStyle = bright > 0.5
      ? `rgba(${tint[0] + 46},${tint[1] + 48},${tint[2] + 54},${0.05 + rand() * 0.16})`
      : `rgba(0,0,0,${0.05 + rand() * 0.16})`;
    c.lineWidth = 0.6 + rand() * 0.9;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx, y + dy); c.stroke();

    const hv = bright > 0.5 ? 200 : 60;
    h.strokeStyle = `rgba(${hv},${hv},${hv},${0.12 + rand() * 0.22})`;
    h.lineWidth = 0.7 + rand() * 1.1;
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + dx, y + dy); h.stroke();
  }

  return { color: col, height: hgt };
}

/* ───────────────────────── metals & plastics ──────────────────────── */

/** Radially brushed aluminium — used for rotary dial faces. */
export function brushedMetal({ size = 512, seed = 31, radial = true, tint = [176, 181, 190] } = {}) {
  const { canvas: col, ctx: c } = createCanvas(size);
  const { canvas: hgt, ctx: h } = createCanvas(size);
  const rand = mulberry32(seed);
  c.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  c.fillRect(0, 0, size, size);
  h.fillStyle = '#808080'; h.fillRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  for (let i = 0; i < 9000; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = rand() * size * 0.72;
    const span = (0.04 + rand() * 0.5) * (radial ? 1 : 0);
    const bright = rand() > 0.5;
    const alpha = 0.03 + rand() * 0.10;
    c.strokeStyle = bright ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    c.lineWidth = 0.5 + rand() * 1.4;
    h.strokeStyle = bright ? `rgba(215,215,215,${alpha * 1.6})` : `rgba(40,40,40,${alpha * 1.6})`;
    h.lineWidth = c.lineWidth;
    c.beginPath(); h.beginPath();
    if (radial) {
      c.arc(cx, cy, r0, a, a + span); h.arc(cx, cy, r0, a, a + span);
    } else {
      const y = rand() * size, len = 20 + rand() * size;
      const x = rand() * size;
      c.moveTo(x, y); c.lineTo(x + len, y + (rand() - 0.5) * 2);
      h.moveTo(x, y); h.lineTo(x + len, y + (rand() - 0.5) * 2);
    }
    c.stroke(); h.stroke();
  }
  return { color: col, height: hgt };
}

/** Vertical knurling for the milled flank of a rotary switch. */
export function knurlHeight({ size = 512, teeth = 72, crossHatch = true } = {}) {
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(0, 0, size, size);
  const step = size / teeth;
  for (let i = 0; i < teeth; i++) {
    const x = i * step;
    const g = ctx.createLinearGradient(x, 0, x + step, 0);
    g.addColorStop(0, '#1a1a1a');
    g.addColorStop(0.5, '#f2f2f2');
    g.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, step, size);
  }
  if (crossHatch) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    const rows = Math.round(teeth / 3);
    const rstep = size / rows;
    for (let j = 0; j < rows; j++) {
      const y = j * rstep;
      const g = ctx.createLinearGradient(0, y, 0, y + rstep);
      g.addColorStop(0, 'rgba(0,0,0,.65)');
      g.addColorStop(0.5, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(0,0,0,.65)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, size, rstep);
    }
    ctx.restore();
  }
  return canvas;
}

/** Fine-grain moulded rubber / textured polymer. */
export function moldedRubber({ size = 512, seed = 57, tint = [22, 23, 26], pebble = 3.0 } = {}) {
  const { canvas: col, ctx: c } = createCanvas(size);
  const { canvas: hgt, ctx: h } = createCanvas(size);
  const fbm = makeFbm(seed, 4, 48);
  const fine = makeValueNoise(seed + 900, 128);
  const ci = c.createImageData(size, size);
  const hi = h.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = fbm(u * 18 * pebble, v * 18 * pebble) * 0.65 + fine(u * 96, v * 96) * 0.35;
      const i = (y * size + x) * 4;
      const k = 0.72 + n * 0.5;
      ci.data[i] = tint[0] * k; ci.data[i + 1] = tint[1] * k; ci.data[i + 2] = tint[2] * k; ci.data[i + 3] = 255;
      const hv = (n * 255) | 0;
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv; hi.data[i + 3] = 255;
    }
  }
  c.putImageData(ci, 0, 0);
  h.putImageData(hi, 0, 0);
  return { color: col, height: hgt };
}

/** Polished / poured concrete for the garage floor. */
export function concrete({ size = 1024, seed = 77 } = {}) {
  const { canvas: col, ctx: c } = createCanvas(size);
  const { canvas: hgt, ctx: h } = createCanvas(size);
  const { canvas: rgh, ctx: r } = createCanvas(size);
  const fbm = makeFbm(seed, 6, 64);
  const grit = makeValueNoise(seed + 11, 256);
  const ci = c.createImageData(size, size);
  const hi = h.createImageData(size, size);
  const ri = r.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = fbm(u * 5, v * 5);
      const g = grit(u * 190, v * 190);
      const i = (y * size + x) * 4;
      const base = 20 + n * 26 + g * 10;
      ci.data[i] = base * 0.98; ci.data[i + 1] = base; ci.data[i + 2] = base * 1.08; ci.data[i + 3] = 255;
      const hv = (n * 160 + g * 95) | 0;
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv; hi.data[i + 3] = 255;
      // Burnished patches read as lower roughness, open pores as higher —
      // but the whole range stays rough. A floor seen at a grazing angle is
      // almost all Fresnel, and a smooth one turns into a mirror of the rig.
      const rv = (152 + n * 78 + g * 25) | 0;
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = Math.min(255, rv); ri.data[i + 3] = 255;
    }
  }
  c.putImageData(ci, 0, 0); h.putImageData(hi, 0, 0); r.putImageData(ri, 0, 0);
  return { color: col, height: hgt, roughness: rgh };
}
