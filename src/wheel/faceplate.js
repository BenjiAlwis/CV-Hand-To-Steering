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
  const rollers = spec.rollers ?? [];

  const minX = -shell.halfWidth, maxX = shell.halfWidth;
  const minY = shell.bottomY, maxY = shell.topY;
  const spanX = maxX - minX, spanY = maxY - minY;

  const W = Math.round(spanX * pixelsPerMetre);
  const H = Math.round(spanY * pixelsPerMetre);

  const { canvas: albedo, ctx: a } = createCanvas(W, H);
  const { canvas: rough, ctx: r } = createCanvas(W, H);
  const { canvas: ao, ctx: o } = createCanvas(W, H);
  // How much lacquer each part of the face carries: full on bare carbon,
  // little on a painted face.
  const { canvas: coat, ctx: k } = createCanvas(W, H);
  k.fillStyle = '#ffffff';
  k.fillRect(0, 0, W, H);

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

  // A painted face (Red Bull): satin black over the whole front, with the
  // weave left bare only where the team shows it — a band along the bottom.
  // The paint is matte, so it takes almost none of the clearcoat that makes
  // the bare carbon glossy, and a rougher finish.
  if (livery.paint) {
    const p = livery.paint;
    // Each bare region is given as its right half, from the centreline out
    // and back, and mirrored; or, if it does not touch the centreline, as a
    // closed patch drawn on both sides.
    // The whole canvas plus the bare regions, filled even-odd: everything but
    // the bare carbon. (clip(path) ignores the context's current path, so
    // the outer rectangle has to be part of the Path2D itself.)
    const bare = new Path2D();
    bare.rect(0, 0, W, H);
    for (const region of p.bare) {
      if (region[0][0] === 0) {
        for (const half of [1, -1]) {
          const pts = half > 0 ? region : [...region].reverse();
          pts.forEach(([x, y], i) => {
            const px = X(half * x), py = Y(y);
            if (i === 0 && half > 0) bare.moveTo(px, py); else bare.lineTo(px, py);
          });
        }
        bare.closePath();
      } else {
        for (const half of [1, -1]) {
          region.forEach(([x, y], i) => (i ? bare.lineTo(X(half * x), Y(y)) : bare.moveTo(X(half * x), Y(y))));
          bare.closePath();
        }
      }
    }
    a.save();
    a.clip(bare, 'evenodd');
    a.fillStyle = p.colour;
    a.fillRect(0, 0, W, H);
    // Panels of another shade on the same part — a sim wheel's lighter
    // upper wings — each given as its right half and mirrored.
    for (const patch of p.patches ?? []) {
      for (const half of [1, -1]) {
        a.beginPath();
        patch.points.forEach(([x, y], i) => (i ? a.lineTo(X(half * x), Y(y)) : a.moveTo(X(half * x), Y(y))));
        a.closePath();
        a.fillStyle = patch.colour;
        a.fill();
      }
    }
    // Brushed metal: fine streaks running across the plate.
    if (p.brushed) {
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < H * 1.4; i++) {
        const y = rnd() * H;
        a.globalAlpha = 0.03 + rnd() * 0.05;
        a.fillStyle = rnd() > 0.5 ? '#ffffff' : '#000000';
        a.fillRect(0, y, W, Math.max(1, S(0.00008)));
      }
      a.globalAlpha = 1;
    }
    a.restore();
    for (const ctx of [r, k]) {
      ctx.save();
      ctx.clip(bare, 'evenodd');
      ctx.fillStyle = ctx === r ? `rgb(${p.roughness * 255 | 0},${p.roughness * 255 | 0},${p.roughness * 255 | 0})` : 'rgb(38,38,38)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

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

  // Bright machined chamfers, printed as strokes (mirrored).
  for (const st of artwork.strokes ?? []) {
    for (const half of [1, -1]) {
      a.beginPath();
      st.points.forEach(([x, y], i) => (i ? a.lineTo(X(half * x), Y(y)) : a.moveTo(X(half * x), Y(y))));
      a.strokeStyle = st.colour;
      a.lineWidth = S(st.width);
      a.lineCap = 'round';
      a.lineJoin = 'round';
      a.stroke();
    }
  }

  // Every recess is cut before any ink goes down, so a neighbouring pocket
  // can never paint over a legend that was already printed.
  // A dial printed on the face (a band) has its knob standing on the print.
  for (const rot of rotaries) if (!rot.band) pocket(rot.x, rot.y, rot.radius * 1.12, 0.85);
  for (const b of buttons) {
    // A rectangular button sits in a rectangular slot.
    if (b.size) slot(b.x, b.y, b.size[0] * 1.18, b.size[1] * 1.3, Math.min(b.size[0], b.size[1]) * 0.4, 0.9);
    else pocket(b.x, b.y, b.radius * 1.17);
  }
  // Screw dimples: a shallow pocket with a hex socket in it.
  for (const [dx, dy, dr] of shell.dimples ?? []) {
    for (const side of dx === 0 ? [1] : [1, -1]) {
      pocket(side * dx, dy, dr, 0.55);
      a.save();
      a.translate(X(side * dx), Y(dy));
      a.beginPath();
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const rr = S(dr * 0.38);
        if (i) a.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); else a.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
      }
      a.closePath();
      a.fillStyle = 'rgba(0,0,0,0.75)';
      a.fill();
      a.restore();
    }
  }
  // Thumb rollers sit in slots let into the carbon.
  for (const t of rollers) if (!t.lift) pocket(t.x, t.y, t.radius * 1.15, 0.9);

  /* ── 3. rotary detent scales + legends ───────────────────────────── */
  for (const rot of rotaries) {
    const px = X(rot.x), py = Y(rot.y);
    const inner = S(rot.radius * 1.24);

    // A ring of coloured number tags (Mercedes): each position printed in
    // its own coloured lozenge round the knob, the full travel, and — on the
    // menu rotary — the mode names in tags outside that.
    // A printed band round an anodised collar (Red Bull): a light or dark
    // annulus, cut into segments by fine keylines, some segments coloured and
    // carrying their position's name.
    if (rot.band) {
      const bd = rot.band;
      const inner = S(bd.inner), outer = S(bd.outer);
      const mid = (inner + outer) / 2;
      // Angles are clockwise from twelve o'clock, in degrees.
      const toCanvas = (deg) => (deg - 90) * Math.PI / 180;
      a.fillStyle = bd.base;
      a.beginPath();
      a.arc(px, py, outer, 0, Math.PI * 2);
      a.arc(px, py, inner, Math.PI * 2, 0, true);
      a.fill();
      r.fillStyle = 'rgba(110,110,110,0.9)';
      r.beginPath();
      r.arc(px, py, outer, 0, Math.PI * 2);
      r.arc(px, py, inner, Math.PI * 2, 0, true);
      r.fill();
      for (const sgm of bd.segments ?? []) {
        const a0 = toCanvas(sgm.at - sgm.width / 2), a1 = toCanvas(sgm.at + sgm.width / 2);
        if (sgm.colour) {
          a.fillStyle = sgm.colour;
          a.beginPath();
          a.arc(px, py, outer, a0, a1);
          a.arc(px, py, inner, a1, a0, true);
          a.closePath();
          a.fill();
        }
        if (sgm.text) {
          const t = toCanvas(sgm.at);
          const tr = bd.textAt != null ? inner + (outer - inner) * bd.textAt : mid;
          const tx = px + Math.cos(t) * tr, ty = py + Math.sin(t) * tr;
          a.save();
          a.translate(tx, ty);
          // Read along the band, never upside down — or, on a printed dial
          // face (Ferrari), always upright.
          if (!bd.upright) {
            let rot2 = t + Math.PI / 2;
            if (Math.sin(t) > 0.2) rot2 += Math.PI;
            a.rotate(rot2);
          }
          a.fillStyle = sgm.ink ?? '#ffffff';
          tracked(a, sgm.text, 0, S(0.0001), S(sgm.size ?? 0.0030), { track: 0.02, weight: 800 });
          a.restore();
        }
      }
      // Keylines between positions.
      a.strokeStyle = bd.divider ?? 'rgba(10,11,14,0.85)';
      a.lineWidth = Math.max(1, S(0.00035));
      for (const deg of bd.dividers ?? []) {
        const t = toCanvas(deg);
        a.beginPath();
        a.moveTo(px + Math.cos(t) * inner, py + Math.sin(t) * inner);
        a.lineTo(px + Math.cos(t) * outer, py + Math.sin(t) * outer);
        a.stroke();
      }
      a.strokeStyle = 'rgba(6,7,9,0.9)';
      for (const rr of [inner, outer]) { a.beginPath(); a.arc(px, py, rr, 0, Math.PI * 2); a.stroke(); }
      continue;
    }
    // A collar rotary with no band carries its name on its own knob.
    if (rot.collar) continue;

    if (rot.ring) {
      // A continuous band of coloured segments, all the way round, with 16 at
      // twelve o'clock and 1 just clockwise of it — as the car's are printed.
      const inner = S(rot.radius * 1.18);
      const outer = S(rot.radius * 1.18 + 0.0055);
      const mid = (inner + outer) / 2;
      const seg = (Math.PI * 2) / rot.detents;
      const angOf = (i) => Math.PI / 2 - (i + 0.5) * seg;   // i = 0 is position 1
      for (let i = 0; i < rot.detents; i++) {
        const ang = angOf(i);
        const colour = rot.ring[i % rot.ring.length];
        a.fillStyle = colour;
        a.beginPath();
        a.arc(px, py, outer, -ang - seg / 2, -ang + seg / 2);
        a.arc(px, py, inner, -ang + seg / 2, -ang - seg / 2, true);
        a.closePath();
        a.fill();
        r.fillStyle = 'rgba(70,70,70,0.9)';
        r.beginPath();
        r.arc(px, py, outer, -ang - seg / 2, -ang + seg / 2);
        r.arc(px, py, inner, -ang + seg / 2, -ang - seg / 2, true);
        r.closePath();
        r.fill();
        const hex = colour.replace('#', '');
        const lum = (0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16)
          + 0.114 * parseInt(hex.slice(4, 6), 16)) / 255;
        a.fillStyle = lum > 0.6 ? '#14161b' : '#ffffff';
        tracked(a, String(i + 1), px + Math.cos(ang) * mid, py - Math.sin(ang) * mid + S(0.0001),
          S(0.0034), { track: -0.04, weight: 800 });
      }
      // A thin dark keyline either side of the band, as printed.
      a.strokeStyle = 'rgba(8,9,12,0.9)';
      a.lineWidth = Math.max(1, S(0.0003));
      for (const rr of [inner, outer]) { a.beginPath(); a.arc(px, py, rr, 0, Math.PI * 2); a.stroke(); }
      const tagR = outer;
      for (const [i, text] of (rot.legends ?? []).entries()) {
        if (!text) continue;
        const ang = angOf(i);
        const lr = tagR + S(0.0042);
        const tx = px + Math.cos(ang) * lr, ty = py - Math.sin(ang) * lr;
        const w = S(0.0012 + text.length * 0.0017), h = S(0.0032);
        a.fillStyle = rot.legendColours?.[i % rot.legendColours.length] ?? '#6a3fc0';
        roundRect(a, tx - w / 2, ty - h / 2, w, h, S(0.0006)); a.fill();
        a.fillStyle = '#ffffff';
        tracked(a, text, tx, ty + h * 0.04, S(0.0022), { track: 0.02, weight: 800 });
      }
      // The rotary's name on an angled tag beside it, as on the car.
      if (rot.labelTag) {
        const lt = rot.labelTag;
        const tx = px + S(lt.dx), ty = py - S(lt.dy);
        a.save();
        a.translate(tx, ty);
        a.rotate(-lt.angle * Math.PI / 180);
        const w = S(0.003 + rot.label.length * 0.0034), h = S(0.0054);
        a.fillStyle = lt.colour;
        roundRect(a, -w / 2, -h / 2, w, h, S(0.0010)); a.fill();
        a.fillStyle = lt.ink ?? '#101216';
        tracked(a, rot.label, 0, h * 0.05, S(0.0040), { track: 0.04, weight: 800 });
        a.restore();
      }
      continue;
    }

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

  /* ── 4. roller and button legends ────────────────────────────────── */
  for (const t of rollers) {
    // A label standing on a raised pod, or set vertically, is a decal on the
    // part itself rather than ink on the face.
    if (!t.labelAt || t.labelVertical) continue;
    const lx = X(t.x + t.labelAt[0]), ly = Y(t.y + t.labelAt[1]);
    a.fillStyle = 'rgba(0,0,0,0.6)';
    tracked(a, t.label, lx, ly + Math.max(1, S(0.00016)), S(0.0030), { track: 0.08 });
    a.fillStyle = 'rgba(226,232,242,0.92)';
    tracked(a, t.label, lx, ly, S(0.0030), { track: 0.08 });
  }

  for (const b of buttons) {
    if (b.labelSide === 'none' || b.labelSide === 'cap') continue;
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
  if (screen) {
    const top = screen.y + screen.height / 2 + screen.bezelTop;
    const bottom = screen.y - screen.height / 2 - screen.bezelBottom;
    slot(screen.x, (top + bottom) / 2, screen.width + screen.bezel * 2, top - bottom, screen.radius, 1);
    const up = screen.module?.upper;
    if (up) slot(screen.x, (top + up.bottom) / 2, up.halfWidth * 2, top - up.bottom, screen.radius, 1);
  }
  // A bar inside the display module needs no slot in the carbon of its own.
  if (lightBar && !lightBar.inScreen) slot(0, lightBar.y, lightBar.width, lightBar.height, lightBar.radius, 0.9);

  /* ── 6. livery + build data ──────────────────────────────────────── */
  if (livery.stripe && lightBar && !lightBar.inScreen) {
    // The 12 o'clock reference stripe, sitting between the bar and the edge.
    const stripeY = (lightBar.y + lightBar.height / 2 + shell.topY) / 2;
    const stripeH = Math.min(0.0070, (shell.topY - lightBar.y - lightBar.height / 2) * 0.62);
    a.fillStyle = livery.stripe;
    roundRect(a, X(-0.0082), Y(stripeY + stripeH / 2), S(0.0164), S(stripeH), S(0.0012));
    a.fill();
    r.fillStyle = 'rgba(200,200,200,0.8)';
    roundRect(r, X(-0.0082), Y(stripeY + stripeH / 2), S(0.0164), S(stripeH), S(0.0012));
    r.fill();
  }

  // Livery inlay just under the top edge — where a team carries one.
  if (livery.inlay !== false) {
    a.fillStyle = livery.accentSoft;
    a.fillRect(0, Y(shell.topY - 0.0062), W, Math.max(1, S(0.0011)));
  }

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

  // Small printed tags: a word on a coloured lozenge, or plain ink.
  for (const tg of artwork.tags ?? []) {
    const size = tg.size ?? 0.0026;
    if (tg.bg) {
      const w = S(0.0016 + tg.text.length * size * 0.72), h = S(size * 1.5);
      a.fillStyle = tg.bg;
      roundRect(a, X(tg.x) - w / 2, Y(tg.y) - h / 2, w, h, S(0.0005)); a.fill();
    }
    const lines = tg.text.split('\n');
    a.save();
    a.translate(X(tg.x), Y(tg.y));
    if (tg.angle) a.rotate(-tg.angle * Math.PI / 180);
    lines.forEach((line, i) => {
      const ly = (i - (lines.length - 1) / 2) * S(size * 1.1);
      // Heavy white legends get a hard black edge, as screen-printed.
      if (tg.edge) {
        a.fillStyle = 'rgba(0,0,0,0.85)';
        tracked(a, line, S(0.0002), ly + S(0.0002), S(size), { track: tg.track ?? 0.06, weight: 900 });
      }
      a.fillStyle = tg.ink ?? '#ffffff';
      tracked(a, line, 0, ly, S(size), { track: tg.track ?? 0.06, weight: tg.edge ? 900 : 800 });
    });
    a.restore();
  }

  const wm = artwork.wordmark;
  if (wm) {
    a.fillStyle = livery.ink;
    tracked(a, wm.text, X(0), Y(wm.y), S(wm.size), { track: wm.track, weight: 600 });
  }

  const bp = artwork.buildPlate;
  if (bp) {
    a.fillStyle = 'rgba(150,164,186,0.40)';
    tracked(a, bp.text, X(0), Y(bp.y), S(bp.size), { track: 0.14, weight: 500 });
  }

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
    clearcoatMap: livery.paint ? mk(coat, false) : null,
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
