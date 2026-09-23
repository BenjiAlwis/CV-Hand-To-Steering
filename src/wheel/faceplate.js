/**
 * Faceplate artwork.
 *
 * Paints the carbon shell's front face for one team: woven base, machined
 * switch pockets, rotary detent scales, silkscreened legends and livery. The
 * canvas is drawn in the same metre space the geometry uses and mapped with
 * `planarUV`, so a legend always lands exactly beneath its button.
 *
 * Three maps come out of here — albedo, roughness and ambient occlusion. The
 * normal map is shared with the raw carbon, since the ink layer is only a few
 * microns proud.
 */
import * as THREE from 'three';
import { createCanvas } from '../textures/procedural.js';
import { LABEL_DROP } from './spec.js';
import { CAP_COLOURS } from './caps.js';

const FONT = '"Arial Narrow", "Helvetica Neue", "Roboto Condensed", Arial, sans-serif';

/** Draws uppercase text with letter tracking, the way switch legends are set. */
function tracked(ctx, text, cx, cy, px, { track = 0.2, align = 'center', weight = 700 } = {}) {
  ctx.font = `${weight} ${px}px ${FONT}`;
  const spacing = px * track;
  const chars = [...text];
  const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let x = align === 'center' ? cx - width / 2 : align === 'right' ? cx - width : cx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const ch of chars) {
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width + spacing;
  }
  return width;
}

export function buildFaceplateTextures(carbon, spec, { pixelsPerMetre = 7600 } = {}) {
  const { shell, screen, lightBar, buttons, rotaries, artwork, livery } = spec;

  const minX = -shell.halfWidth, maxX = shell.halfWidth;
  const minY = shell.bottomY, maxY = shell.topY;
  const spanX = maxX - minX, spanY = maxY - minY;

  const W = Math.round(spanX * pixelsPerMetre);
  const H = Math.round(spanY * pixelsPerMetre);

  const { canvas: albedo, ctx: a } = createCanvas(W, H);
  const { canvas: rough, ctx: r } = createCanvas(W, H);
  const { canvas: ao, ctx: o } = createCanvas(W, H);

  const X = (x) => ((x - minX) / spanX) * W;
  const Y = (y) => (1 - (y - minY) / spanY) * H;
  const S = (m) => (m / spanX) * W;

  /* ── 1. woven base ───────────────────────────────────────────────── */
  const tile = S(0.044);
  for (let ty = 0; ty < H; ty += tile) {
    for (let tx = 0; tx < W; tx += tile) {
      a.drawImage(carbon.color, tx, ty, tile, tile);
      r.drawImage(carbon.roughness, tx, ty, tile, tile);
    }
  }
  // Team tint goes on here, over the bare weave and before any ink. Doing it
  // with the material's colour instead would multiply the printed legends
  // too and leave them barely legible. `color` blending keeps the weave's
  // luminance and swaps only its hue, so the cloth still reads as cloth.
  if (livery.weaveTint) {
    a.save();
    a.globalCompositeOperation = 'color';
    a.fillStyle = livery.weaveTint;
    a.fillRect(0, 0, W, H);
    a.restore();
  }
  r.fillStyle = 'rgba(128,128,128,0.45)';
  r.fillRect(0, 0, W, H);
  o.fillStyle = '#ffffff';
  o.fillRect(0, 0, W, H);

  /* ── 2. machined pockets ─────────────────────────────────────────── */
  const pocket = (cx, cy, radius, depth = 1) => {
    const px = X(cx), py = Y(cy), pr = S(radius);

    const shade = a.createRadialGradient(px, py, pr * 0.55, px, py, pr * 1.55);
    shade.addColorStop(0, `rgba(0,0,0,${0.72 * depth})`);
    shade.addColorStop(0.62, `rgba(0,0,0,${0.34 * depth})`);
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = shade;
    a.beginPath(); a.arc(px, py, pr * 1.55, 0, Math.PI * 2); a.fill();

    a.fillStyle = `rgba(6,7,10,${0.92 * depth})`;
    a.beginPath(); a.arc(px, py, pr, 0, Math.PI * 2); a.fill();

    a.save();
    a.beginPath(); a.arc(px, py, pr, 0, Math.PI * 2); a.clip();
    const rim = a.createLinearGradient(0, py - pr, 0, py + pr);
    rim.addColorStop(0, 'rgba(0,0,0,0.55)');
    rim.addColorStop(0.55, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(190,205,225,0.14)');
    a.fillStyle = rim; a.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    a.restore();

    a.strokeStyle = 'rgba(178,192,212,0.20)';
    a.lineWidth = Math.max(1, S(0.00022));
    a.beginPath(); a.arc(px, py, pr, 0, Math.PI * 2); a.stroke();

    r.fillStyle = 'rgba(210,210,210,0.85)';
    r.beginPath(); r.arc(px, py, pr, 0, Math.PI * 2); r.fill();

    const occ = o.createRadialGradient(px, py, pr * 0.4, px, py, pr * 1.9);
    occ.addColorStop(0, `rgba(0,0,0,${0.85 * depth})`);
    occ.addColorStop(0.5, `rgba(0,0,0,${0.35 * depth})`);
    occ.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = occ;
    o.beginPath(); o.arc(px, py, pr * 1.9, 0, Math.PI * 2); o.fill();
  };

  const slot = (cx, cy, w, h, radius, depth = 1) => {
    const px = X(cx), py = Y(cy), pw = S(w), ph = S(h), pr = S(radius);
    o.save();
    o.filter = `blur(${S(0.0020)}px)`;
    o.fillStyle = `rgba(0,0,0,${0.7 * depth})`;
    roundRect(o, px - pw / 2 - S(0.0018), py - ph / 2 - S(0.0018), pw + S(0.0036), ph + S(0.0036), pr);
    o.fill();
    o.restore();

    a.save();
    a.filter = `blur(${S(0.0016)}px)`;
    a.fillStyle = `rgba(0,0,0,${0.6 * depth})`;
    roundRect(a, px - pw / 2 - S(0.0016), py - ph / 2 - S(0.0016), pw + S(0.0032), ph + S(0.0032), pr);
    a.fill();
    a.restore();

    a.fillStyle = '#05060a';
    roundRect(a, px - pw / 2, py - ph / 2, pw, ph, pr); a.fill();
    a.strokeStyle = 'rgba(178,192,212,0.22)';
    a.lineWidth = Math.max(1, S(0.00022));
    roundRect(a, px - pw / 2, py - ph / 2, pw, ph, pr); a.stroke();

    r.fillStyle = 'rgba(40,40,40,0.9)';
    roundRect(r, px - pw / 2, py - ph / 2, pw, ph, pr); r.fill();
  };

  // Every recess is cut before any ink goes down, so a neighbouring pocket
  // can never paint over a legend that was already printed.
  for (const rot of rotaries) pocket(rot.x, rot.y, rot.radius * 1.12, 0.85);
  for (const b of buttons) pocket(b.x, b.y, b.radius * 1.17);

  /* ── 3. rotary detent scales + legends ───────────────────────────── */
  for (const rot of rotaries) {
    const px = X(rot.x), py = Y(rot.y);
    const inner = S(rot.radius * 1.24);

    const collar = a.createRadialGradient(px, py, inner, px, py, S(rot.scale));
    collar.addColorStop(0, 'rgba(26,29,35,0.85)');
    collar.addColorStop(1, 'rgba(12,14,18,0.0)');
    a.fillStyle = collar;
    a.beginPath(); a.arc(px, py, S(rot.scale), 0, Math.PI * 2); a.fill();

    // ~295° of travel, with the gap at the bottom where the legend goes.
    const sweep = Math.PI * 2 * 0.82;
    const startAngle = Math.PI / 2 + sweep / 2;

    for (let i = 0; i < rot.detents; i++) {
      const t = i / (rot.detents - 1);
      const ang = startAngle - sweep * t;
      const major = i % 3 === 0;
      const r0 = inner + S(0.0004);
      const r1 = r0 + S(major ? 0.0024 : 0.0014);
      a.strokeStyle = major ? 'rgba(228,235,245,0.9)' : 'rgba(186,198,216,0.52)';
      a.lineWidth = Math.max(1, S(major ? 0.00038 : 0.00026));
      a.beginPath();
      a.moveTo(px + Math.cos(ang) * r0, py - Math.sin(ang) * r0);
      a.lineTo(px + Math.cos(ang) * r1, py - Math.sin(ang) * r1);
      a.stroke();

      if (major) {
        const rl = r1 + S(0.0020);
        a.fillStyle = 'rgba(224,232,243,0.80)';
        tracked(a, String(i + 1), px + Math.cos(ang) * rl, py - Math.sin(ang) * rl, S(0.0024), { track: 0 });
      }
    }

    const ly = Y(rot.y - rot.scale - 0.0026);
    a.fillStyle = 'rgba(0,0,0,0.6)';
    tracked(a, rot.label, px, ly + Math.max(1, S(0.00016)), S(0.0032), { track: 0.26 });
    a.fillStyle = 'rgba(234,240,249,0.92)';
    tracked(a, rot.label, px, ly, S(0.0032), { track: 0.26 });
    r.fillStyle = 'rgba(235,235,235,0.7)';
    tracked(r, rot.label, px, ly, S(0.0032), { track: 0.26 });
  }

  /* ── 4. button legends ───────────────────────────────────────────── */
  for (const b of buttons) {
    const ink = CAP_COLOURS[b.colour]?.label ?? '#cfd6e2';
    const drop = b.labelSide === 'above' ? LABEL_DROP : -LABEL_DROP;
    const ly = Y(b.y + drop);
    a.fillStyle = 'rgba(0,0,0,0.65)';
    tracked(a, b.label, X(b.x), ly + Math.max(1, S(0.00016)), S(0.0028), { track: 0.22 });
    a.fillStyle = ink;
    tracked(a, b.label, X(b.x), ly, S(0.0028), { track: 0.22 });
    r.fillStyle = 'rgba(240,240,240,0.75)';
    tracked(r, b.label, X(b.x), ly, S(0.0028), { track: 0.22 });
  }

  /* ── 5. display + rev-light recesses ─────────────────────────────── */
  slot(screen.x, screen.y, screen.width + screen.bezel * 2, screen.height + screen.bezel * 2, screen.radius, 1);
  slot(0, lightBar.y, lightBar.width, lightBar.height, lightBar.radius, 0.9);

  /* ── 6. livery + build data ──────────────────────────────────────── */
  // The 12 o'clock reference stripe, sitting between the bar and the edge.
  const stripeY = (lightBar.y + lightBar.height / 2 + shell.topY) / 2;
  const stripeH = Math.min(0.0070, (shell.topY - lightBar.y - lightBar.height / 2) * 0.62);
  a.fillStyle = livery.stripe;
  roundRect(a, X(-0.0082), Y(stripeY + stripeH / 2), S(0.0164), S(stripeH), S(0.0012));
  a.fill();
  r.fillStyle = 'rgba(200,200,200,0.8)';
  roundRect(r, X(-0.0082), Y(stripeY + stripeH / 2), S(0.0164), S(stripeH), S(0.0012));
  r.fill();

  // Livery inlay just under the top edge.
  a.fillStyle = livery.accentSoft;
  a.fillRect(0, Y(shell.topY - 0.0062), W, Math.max(1, S(0.0011)));

  // A team mark where that team actually carries one: Ferrari's shield low and
  // centre, Petronas green in Mercedes' bottom right corner.
  if (livery.corner) {
    const c = livery.corner;
    for (const side of [-1, 1]) {
      a.fillStyle = side > 0 ? c.colour : 'rgba(255,255,255,0.10)';
      roundRect(a, X(side * c.x - c.width / 2), Y(c.y + c.height / 2),
        S(c.width), S(c.height), S(0.0014));
      a.fill();
    }
  }

  if (livery.badge) {
    const b = livery.badge;
    a.fillStyle = b.colour;
    tracked(a, b.text, X(0), Y(b.y - 0.0072), S(0.0062), { track: 0.16, weight: 700 });
  }

  const wm = artwork.wordmark;
  a.fillStyle = livery.ink;
  tracked(a, wm.text, X(0), Y(wm.y), S(wm.size), { track: wm.track, weight: 600 });

  const bp = artwork.buildPlate;
  a.fillStyle = 'rgba(150,164,186,0.40)';
  tracked(a, bp.text, X(0), Y(bp.y), S(bp.size), { track: 0.14, weight: 500 });

  /* ── 7. edge shading ─────────────────────────────────────────────── */
  const vig = a.createRadialGradient(W / 2, H * 0.44, Math.min(W, H) * 0.22, W / 2, H * 0.5, Math.max(W, H) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  a.fillStyle = vig;
  a.fillRect(0, 0, W, H);

  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 16;
    return t;
  };

  return {
    map: mk(albedo, true),
    roughnessMap: mk(rough, false),
    aoMap: mk(ao, false),
    bounds: { minX, minY, maxX, maxY },
    debug: { albedo, rough, ao },
  };
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
