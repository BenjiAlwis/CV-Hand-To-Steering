/**
 * The steering wheel itself.
 *
 * Assembles one team's wheel from its resolved spec: a sculpted carbon shell,
 * two hand grips faired into it, the fascia switchgear, the centre LCD, the
 * rev-light bar, four paddles and a quick-release hub.
 *
 * Public surface is deliberately small — `group`, `setAngle()` and `update()`
 * — so the input layer never has to know how any of this is built.
 */
import * as THREE from 'three';
import {
  capLegendTexture, rollerTexture, knobShape, stackedLabelTexture, emblemTexture, tabTextTexture,
} from './decals.js';
import { planarUV, buttonCapGeometry, rotaryBodyGeometry, plateGeometry, roundedPolyShape } from './geometry.js';
import { Display } from './display.js';
import { RevLights } from './revlights.js';
import { CAP_COLOURS } from './caps.js';

/** The rounded edge on a display module's glass, which stands proud of its depth. */
const MODULE_BEVEL = 0.0008;

export class SteeringWheel {
  /**
   * @param {object} materials from `buildMaterials`
   * @param {object} spec from `buildSpec`
   */
  constructor(materials, spec) {
    this.materials = materials;
    this.spec = spec;
    this.group = new THREE.Group();
    this.group.name = `wheel:${spec.id}`;

    this.shellGroup = new THREE.Group();
    this.group.add(this.shellGroup);

    this._disposables = [];
    this._buildShell();
    this._buildGrips();
    this._buildPods();
    this._buildSwitchgear();
    this._buildFittings();
    this._buildRollers();
    this._buildDisplay();
    this._buildRevLights();
    this._buildPaddles();
    this._buildBackDetail();
    this._buildHub();

    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    this.angle = 0;
  }

  /* ─────────────────────────── carbon shell ─────────────────────────── */

  _buildShell() {
    const { faceplate, carbonBack, carbonEdge, titanium } = this.materials;
    const { shell } = this.spec;

    // The outline arrives as a dense polyline from the spline sampler, so it
    // goes straight into the Shape — no need to refit curves to it.
    const contour = new THREE.Shape();
    shell.outline.forEach(([x, y], i) => (i ? contour.lineTo(x, y) : contour.moveTo(x, y)));
    contour.closePath();

    const depth = shell.extrudeDepth;
    const geo = new THREE.ExtrudeGeometry(contour, {
      depth,
      bevelEnabled: true,
      bevelThickness: shell.bevel,
      bevelSize: shell.bevel,
      bevelOffset: 0,
      // Enough steps round the moulded edge that it reads as a curve in a
      // highlight, not as three facets.
      bevelSegments: 7,
      curveSegments: 1,
    });

    splitExtrudeGroups(geo);
    geo.translate(0, 0, -depth / 2);
    planarUV(geo, -shell.halfWidth, shell.bottomY, shell.halfWidth, shell.topY);

    const mesh = new THREE.Mesh(geo, [faceplate, carbonEdge, carbonBack]);
    mesh.name = 'shell';
    this.shellGroup.add(mesh);
    this._disposables.push(geo);

    // Mounting bolts through the shell into the hub casting, placed relative
    // to the outline so they land on carbon whatever the team's shape.
    const boltGeo = new THREE.CylinderGeometry(0.0022, 0.0024, 0.0016, 12);
    boltGeo.rotateX(Math.PI / 2);
    this._disposables.push(boltGeo);
    const inset = 0.010;
    // A shell given as measured stations says where its bolts are; the
    // others are placed from their outline's named points.
    const boltSpots = shell.bolts
      ? shell.bolts.flatMap(([x, y]) => [[-x, y], [x, y]])
      : [
        [-shell.topCornerX * 0.28, shell.topY - inset],
        [shell.topCornerX * 0.28, shell.topY - inset],
        [-shell.shoulderX + inset * 1.5, shell.shoulderY],
        [shell.shoulderX - inset * 1.5, shell.shoulderY],
        [-shell.legOuterX + inset, shell.legBottomY + inset * 1.6],
        [shell.legOuterX - inset, shell.legBottomY + inset * 1.6],
      ];
    for (const [x, y] of boltSpots) {
      const bolt = new THREE.Mesh(boltGeo, titanium);
      bolt.position.set(x, y, shell.frontZ + 0.0006 + this._liftAt(x, y));
      this.shellGroup.add(bolt);
    }
  }

  /**
   * How far a point on the face stands forward because it is on a raised
   * display housing (Ferrari's whole upper centre plate) rather than on the
   * face itself.
   */
  _liftAt(x, y) {
    const { screen } = this.spec;
    const m = screen?.module;
    if (!m?.carriesFittings) return 0;
    const top = screen.y + screen.height / 2 + screen.bezelTop;
    const bottom = screen.y - screen.height / 2 - screen.bezelBottom;
    return Math.abs(x - screen.x) < screen.width / 2 + screen.bezel && y > bottom && y < top
      ? m.depth + MODULE_BEVEL : 0;
  }

  /* ────────────────────────────── grips ─────────────────────────────── */

  _buildGrips() {
    const { grip, shell } = this.spec;

    // A round wheel — a sim racing wheel, a road car's — has one continuous
    // rim rather than two grips.
    if (grip.rim) { this._buildRim(grip.rim); return; }

    for (const side of [-1, 1]) {
      const geo = buildGripGeometry(side, grip, shell);
      this._disposables.push(geo);
      const main = grip.material === 'silicone' ? this.materials.silicone
        : grip.material === 'greySilicone' ? this.materials.greySilicone : this.materials.grip;
      // A two-tone grip (Red Bull) is a separate sleeve over the lower half.
      const mesh = new THREE.Mesh(geo, grip.split ? [main, this.materials.sleeve] : main);
      mesh.name = `grip${side < 0 ? 'L' : 'R'}`;
      mesh.castShadow = true;
      this.group.add(mesh);

      // Moulded rubber thumb rest on the driver-facing inboard quadrant.
      const pad = grip.thumbPad;
      if (pad) {
        const padGeo = plateGeometry(pad.width, pad.height, 0.0060, 0.0010);
        this._disposables.push(padGeo);
        const padMesh = new THREE.Mesh(padGeo, this.materials.thumbPad);
        padMesh.position.set(
          side * (grip.centreX - grip.halfWidth * 0.30),
          pad.y,
          grip.z + grip.halfDepth * 0.86,
        );
        padMesh.rotation.y = side * 0.42;
        this.group.add(padMesh);
      }

      // A round thumb boss moulded on the grip's front face (Ferrari).
      if (grip.boss) {
        const bGeo = new THREE.SphereGeometry(grip.boss.radius, 32, 16);
        bGeo.scale(1, 1, grip.boss.flat ?? 0.45);
        this._disposables.push(bGeo);
        const boss = new THREE.Mesh(bGeo, mesh.material[0] ?? mesh.material);
        boss.position.set(side * grip.boss.x, grip.boss.y, grip.z + grip.halfDepth * (grip.boss.zAt ?? 0.82));
        boss.castShadow = true;
        this.group.add(boss);
      }

      // A grip hung beside the body rather than moulded into it is held by
      // carbon bridges, with open windows between them — the Mercedes.
      for (const b of grip.bridges ?? []) {
        const inner = b.fromX;
        const outer = grip.centreX - grip.halfWidth * 0.4;
        const geo = plateGeometry(outer - inner, b.height, Math.min(0.003, b.height / 3), this.spec.shell.thickness * 0.9);
        this._disposables.push(geo);
        const bridge = new THREE.Mesh(geo, this.materials.carbonBack);
        bridge.position.set(side * (inner + outer) / 2, b.y, 0);
        bridge.castShadow = true;
        this.group.add(bridge);
      }

      this._buildThumbControls(side);
    }
  }

  /**
   * A continuous rim: a tube swept round a circle, or round any closed
   * outline, with a rounded-rectangle section. Bands of a second material —
   * a coloured top marker, leather grips on a rubber rim — go by angle,
   * measured clockwise from twelve o'clock.
   */
  _buildRim(rim) {
    const geo = buildRimGeometry(rim);
    this._disposables.push(geo);
    const pick = (name) => ({
      silicone: this.materials.silicone, greySilicone: this.materials.greySilicone, leather: this.materials.leather,
      sleeve: this.materials.sleeve, suede: this.materials.grip, gloss: this.materials.bezelBlack,
    }[name] ?? this.materials.grip);
    const mats = [pick(rim.material), ...(rim.bands ?? []).map((b) => {
      if (!b.colour) return pick(b.material);
      const m = new THREE.MeshPhysicalMaterial({ color: b.colour, roughness: b.roughness ?? 0.6, sheen: 0.3, sheenRoughness: 0.7 });
      this._disposables.push(m);
      return m;
    })];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.name = 'rim';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.z = rim.z ?? 0;
    this.group.add(mesh);
    // The thumb controls on a grip have nowhere to go on a plain rim.
  }

  /** Rotaries and buttons moulded into the inboard face of a grip. */
  _buildThumbControls(side) {
    const { grip } = this.spec;
    const { dialFace, dialFlank } = this.materials;

    const faceX = side * (grip.centreX - grip.halfWidth * 0.52);
    const faceZ = grip.z + grip.halfDepth * 0.88;

    for (const def of grip.thumbRotaries) {
      if (def.side !== 0 && def.side !== side) continue;
      const dial = new THREE.Group();
      dial.position.set(faceX, def.y, faceZ);
      dial.rotation.y = side * 0.52;

      const flankGeo = new THREE.CylinderGeometry(def.radius, def.radius * 0.99, def.height * 0.8, 40, 1, true);
      flankGeo.rotateX(Math.PI / 2);
      this._disposables.push(flankGeo);
      const flank = new THREE.Mesh(flankGeo, dialFlank);
      flank.position.z = def.height * 0.4;
      dial.add(flank);

      const capGeo = rotaryBodyGeometry(def.radius, def.height, { chamfer: 0.2, segments: 40 });
      capGeo.rotateX(-Math.PI / 2);
      this._disposables.push(capGeo);
      dial.add(new THREE.Mesh(capGeo, dialFace));

      const pointerGeo = plateGeometry(0.0013, def.radius * 0.72, 0.0006, 0.0004);
      this._disposables.push(pointerGeo);
      const pointer = new THREE.Mesh(pointerGeo, new THREE.MeshPhysicalMaterial({
        color: def.pointer, roughness: 0.3, metalness: 0.1, clearcoat: 0.8,
        emissive: new THREE.Color(def.pointer).multiplyScalar(0.12),
      }));
      pointer.position.set(0, def.radius * 0.44, def.height + 0.0002);
      dial.add(pointer);

      const sweep = Math.PI * 2 * 0.82;
      dial.rotation.z = sweep / 2 - sweep * ((def.value - 1) / (def.detents - 1));
      this.group.add(dial);
    }

    for (const def of grip.thumbButtons) {
      if (def.side !== 0 && def.side !== side) continue;
      const geo = buttonCapGeometry(def.radius, def.height, { fillet: 0.4, dome: 0.12, segments: 28 });
      geo.rotateX(Math.PI / 2);
      this._disposables.push(geo);
      const cap = new THREE.Mesh(geo, this.materials.caps[def.colour] ?? this.materials.caps.grey);
      cap.position.set(faceX, def.y, faceZ);
      cap.rotation.y = side * 0.52;
      cap.userData.label = def.label;
      this.group.add(cap);
    }
  }

  /* ──────────────────────────── switchgear ──────────────────────────── */

  _buildSwitchgear() {
    const { titanium, dialFace, dialFlank, anodisedBlack } = this.materials;
    const { buttons, rotaries, shell } = this.spec;
    this.buttons = new Map();
    this.rotaries = new Map();

    // Geometry shared between buttons of one size — most of a wheel's
    // buttons are the same part number, but not all (Red Bull's N and PIT
    // are bigger, the unmarked ones smaller).
    // The bezel round a cap: a thin titanium collar flush with the face, or
    // a proud ring the cap sits down inside — glossy black (Red Bull) or
    // bright machined silver (a sim wheel). Per button, or the wheel's own.
    const bezelOf = (b) => (b.bezel === false ? null : b.bezel ?? this.spec.livery.buttonBezel ?? 'collar');
    const sizes = new Map();
    const partsFor = (b) => {
      const style = bezelOf(b);
      const key = `${b.radius}|${b.height}|${b.size ?? ''}|${style}`;
      if (sizes.has(key)) return sizes.get(key);
      let capGeo;
      if (b.size) {
        // A rectangular cap (a sim wheel's S1, HOME, MENU…), standing out of
        // the face from z = 0 like the round ones.
        const [w, h] = b.size;
        capGeo = plateGeometry(w, h, Math.min(w, h) * 0.32, b.height * 0.7, b.height * 0.15);
        capGeo.translate(0, 0, b.height * 0.5);
      } else {
        capGeo = buttonCapGeometry(b.radius, b.height);
        capGeo.rotateX(Math.PI / 2);
      }
      let collarGeo = null;
      if (style === 'black' || style === 'silver') collarGeo = bezelGeometry(b.radius * 1.08, b.radius * (b.bezelScale ?? 1.42), 0.0026);
      else if (style === 'collar') collarGeo = new THREE.CylinderGeometry(b.radius * 1.19, b.radius * 1.19, 0.0010, 28, 1, true).rotateX(Math.PI / 2);
      this._disposables.push(capGeo);
      if (collarGeo) this._disposables.push(collarGeo);
      const parts = { capGeo, collarGeo, style };
      sizes.set(key, parts);
      return parts;
    };

    for (const b of buttons) {
      const { capGeo, collarGeo, style } = partsFor(b);
      const cap = new THREE.Mesh(capGeo, this._capMaterial(b.colour));
      // A cap on a raised moulding or the display housing rides up with it.
      const lift = (b.lift ?? 0) + this._liftAt(b.x, b.y);
      cap.position.set(b.x, b.y, shell.frontZ - 0.0021 + lift);
      cap.userData.id = b.id;
      this.shellGroup.add(cap);

      // A legend printed on the cap itself, riding on its crown so it moves
      // with the cap when it is pressed.
      if (b.labelSide === 'cap') {
        const ink = CAP_COLOURS[b.colour]?.label ?? (b.colour?.startsWith?.('#') ? '#111111' : '#ffffff');
        const rect = !!b.size;
        const plane = rect
          ? new THREE.PlaneGeometry(b.size[0] * 0.92, b.size[1] * 0.82)
          : new THREE.PlaneGeometry(b.radius * 1.55, b.radius * 1.55);
        const decal = new THREE.Mesh(
          plane,
          new THREE.MeshPhysicalMaterial({
            map: rect ? tabTextTexture(b.legend ?? b.label, b.ink ?? ink, b.size[0] / b.size[1])
              : capLegendTexture(b.legend ?? ({ RADIO: '@radio', X: '@cancel' }[b.label] ?? b.label), b.ink ?? ink, b.split),
            transparent: true, roughness: 0.35, clearcoat: 0.6, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2,
          }),
        );
        decal.position.z = rect ? b.height + b.height * 0.15 + 0.00004 : b.height + b.radius * 0.09 + 0.00004;
        this._disposables.push(decal.geometry, decal.material);
        cap.add(decal);
      }

      if (collarGeo) {
        const proud = style === 'black' || style === 'silver';
        const collar = new THREE.Mesh(collarGeo, style === 'black' ? this.materials.bezelBlack
          : style === 'silver' ? this.materials.bezelSilver : titanium);
        collar.position.set(b.x, b.y, (proud ? shell.frontZ : shell.frontZ - 0.0006) + lift);
        this.shellGroup.add(collar);
      }

      this.buttons.set(b.id, { def: b, cap, restZ: cap.position.z, press: 0 });
    }

    // D-pads: one cross-shaped rocker carrying four buttons. Each direction
    // is a button of its own (and the press tips the whole cross).
    for (const d of this.spec.dpads ?? []) {
      const a = d.arm / 2, r = d.size / 2;
      const cross = new THREE.Shape();
      const pts = [[-a, r], [a, r], [a, a], [r, a], [r, -a], [a, -a], [a, -r], [-a, -r], [-a, -a], [-r, -a], [-r, a], [-a, a]];
      pts.forEach(([x, y], i) => (i ? cross.lineTo(x, y) : cross.moveTo(x, y)));
      cross.closePath();
      const h = d.height ?? 0.0045;
      const geo = new THREE.ExtrudeGeometry(cross, {
        depth: h * 0.7, bevelEnabled: true, bevelThickness: h * 0.15, bevelSize: a * 0.18, bevelSegments: 4, curveSegments: 4,
      });
      this._disposables.push(geo);
      const pad = new THREE.Mesh(geo, this._capMaterial(d.colour ?? 'black'));
      pad.position.set(d.x, d.y, shell.frontZ - 0.0010);
      pad.castShadow = true;
      this.shellGroup.add(pad);
      // Arrows printed on each arm.
      const arrowTex = capLegendTexture('▲', d.ink ?? '#c9ced6');
      for (const [dir, ang] of [['up', 0], ['right', -Math.PI / 2], ['down', Math.PI], ['left', Math.PI / 2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(a * 1.1, a * 1.1), new THREE.MeshPhysicalMaterial({
          map: arrowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
        }));
        this._disposables.push(m.geometry, m.material);
        const off = (r + a) / 2 + a * 0.15;
        m.position.set(-Math.sin(ang) * off, Math.cos(ang) * off, h + h * 0.15 + 0.00004);
        m.rotation.z = ang;
        pad.add(m);
        const id = d.ids?.[dir];
        // Each direction rocks the cross toward itself rather than pushing
        // the whole of it straight down.
        if (id) this.buttons.set(id, { def: { id, hid: d.hid?.[dir] }, cap: pad, restZ: pad.position.z, press: 0, rock: dir });
      }
    }

    for (const r of rotaries) {
      const dial = new THREE.Group();
      dial.position.set(r.x, r.y, shell.frontZ - 0.0010);

      // An anodised collar (Red Bull): a glossy black bezel, a coloured
      // aluminium collar standing in it, and a black knurled knob on top
      // with the rotary's name printed across its crown.
      // Ferrari: a tall black pointer knob standing on a printed dial, or
      // the centre rotary's cogged ring round the yellow badge.
      if (r.knobStyle === 'bat' || r.knobStyle === 'emblem') {
        if (r.knobStyle === 'bat') this._buildBatKnob(dial, r);
        else this._buildEmblemKnob(dial, r);
        this.shellGroup.add(dial);
        this.rotaries.set(r.id, { def: r, dial });
        continue;
      }

      if (r.collar) {
        this._buildCollarRotary(dial, r);
        this.shellGroup.add(dial);
        this.rotaries.set(r.id, { def: r, dial });
        continue;
      }

      // A coloured knob (Mercedes): a scalloped, pointed moulding in the
      // knob's own colour, the outline a thumb can feel.
      if (r.knob) {
        const knobGeo = new THREE.ExtrudeGeometry(knobShape(r.radius, r.lobes ?? 10, 0.07), {
          depth: r.height * 0.7, bevelEnabled: true, bevelThickness: r.height * 0.18,
          bevelSize: r.radius * 0.07, bevelSegments: 4, curveSegments: 4,
        });
        this._disposables.push(knobGeo);
        const knobMat = new THREE.MeshPhysicalMaterial({
          color: r.knob, roughness: 0.32, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.2,
        });
        this._disposables.push(knobMat);
        const knob = new THREE.Mesh(knobGeo, knobMat);
        knob.castShadow = true;
        dial.add(knob);

        const tipGeo = plateGeometry(0.0016, r.radius * 0.62, 0.0007, 0.0004);
        this._disposables.push(tipGeo);
        const tip = new THREE.Mesh(tipGeo, new THREE.MeshPhysicalMaterial({ color: 0x14161b, roughness: 0.4 }));
        tip.position.set(0, r.radius * 0.5, r.height * 0.88 + 0.0003);
        dial.add(tip);

        const sweep = Math.PI * 2 * 0.82;
        dial.rotation.z = sweep / 2 - sweep * ((r.value - 1) / (r.detents - 1));
        this.shellGroup.add(dial);
        this.rotaries.set(r.id, { def: r, dial });
        continue;
      }

      const flankGeo = new THREE.CylinderGeometry(r.radius, r.radius * 0.99, r.height * 0.82, 56, 1, true);
      flankGeo.rotateX(Math.PI / 2);
      this._disposables.push(flankGeo);
      const flank = new THREE.Mesh(flankGeo, dialFlank);
      flank.position.z = r.height * 0.41;
      dial.add(flank);

      const capGeoR = rotaryBodyGeometry(r.radius, r.height, { chamfer: 0.16, segments: 56 });
      capGeoR.rotateX(-Math.PI / 2);
      this._disposables.push(capGeoR);
      dial.add(new THREE.Mesh(capGeoR, dialFace));

      const pointerGeo = plateGeometry(0.0017, r.radius * 0.74, 0.0008, 0.0005);
      this._disposables.push(pointerGeo);
      const pointer = new THREE.Mesh(pointerGeo, new THREE.MeshPhysicalMaterial({
        color: r.pointer, roughness: 0.30, metalness: 0.1,
        clearcoat: 0.8, clearcoatRoughness: 0.15,
        emissive: new THREE.Color(r.pointer).multiplyScalar(0.12),
      }));
      pointer.position.set(0, r.radius * 0.46, r.height + 0.0002);
      dial.add(pointer);

      const skirtGeo = new THREE.CylinderGeometry(r.radius * 1.14, r.radius * 1.14, 0.0012, 48, 1, true);
      this._disposables.push(skirtGeo);
      const skirt = new THREE.Mesh(skirtGeo, anodisedBlack);
      skirt.rotation.x = Math.PI / 2;
      skirt.position.z = 0.0004;
      dial.add(skirt);

      const sweep = Math.PI * 2 * 0.82;
      dial.rotation.z = sweep / 2 - sweep * ((r.value - 1) / (r.detents - 1));

      this.shellGroup.add(dial);
      this.rotaries.set(r.id, { def: r, dial });
    }
  }

  /**
   * Barrel thumb rollers set into the body: a ribbed drum on a horizontal
   * axle, half sunk in its slot, turned by rolling a thumb across it. Their
   * colour says what they adjust.
   */
  _buildRollers() {
    const { shell, rollers } = this.spec;
    if (!rollers?.length) return;
    for (const t of rollers) {
      const drum = new THREE.Group();
      // A drum on a raised pod (Red Bull) stands on the pod's face.
      const base = shell.frontZ + (t.lift ?? 0);
      drum.position.set(t.x, t.y, base - t.radius * 0.35);
      // The drum's axle runs across the face at `axis` degrees from
      // horizontal; the thumb rolls it at right angles to that.
      drum.rotation.z = (t.axis ?? 0) * Math.PI / 180;
      const body = new THREE.CylinderGeometry(t.radius, t.radius, t.length, 48, 1);
      body.rotateZ(Math.PI / 2);
      // Turn the printing so the middle number faces the driver.
      body.rotateX(Math.PI / 2);
      this._disposables.push(body);
      const cap = CAP_COLOURS[t.colour] ?? CAP_COLOURS.grey;
      const metal = t.colour === 'gold' || t.colour === 'silver';
      const mat = new THREE.MeshPhysicalMaterial({
        map: rollerTexture(cap.base, t.numbers ?? [], cap.label, Math.PI / 2 + ((t.axis ?? 0) * Math.PI) / 180),
        roughness: metal ? 0.3 : 0.4, metalness: metal ? 0.85 : 0.0,
        clearcoat: metal ? 0 : 0.5, clearcoatRoughness: 0.25,
      });
      this._disposables.push(mat);
      const mesh = new THREE.Mesh(body, mat);
      mesh.castShadow = true;
      // Roll the drum until the number it is set to faces the driver (the
      // face sits a quarter of the way round the texture).
      const count = t.numbers?.length ?? 0;
      if (count) mesh.rotation.x = (1 - ((t.showing ?? 0) + 0.5) / count - 0.25) * Math.PI * 2;
      drum.add(mesh);
      // Thin end flanges, as on the real drums.
      const flange = new THREE.CylinderGeometry(t.radius * 1.04, t.radius * 1.04, t.length * 0.08, 40);
      flange.rotateZ(Math.PI / 2);
      this._disposables.push(flange);
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(flange, this.materials.anodisedBlack);
        f.position.x = s * t.length * 0.5;
        drum.add(f);
      }
      this.shellGroup.add(drum);

      // A pointer line beside the window, which the number lines up with.
      if (t.pointer) {
        const pGeo = plateGeometry(t.pointer.length, 0.0009, 0.0004, 0.0006);
        this._disposables.push(pGeo);
        const p = new THREE.Mesh(pGeo, this.materials.inkWhite);
        p.position.set(t.x + t.pointer.dx, t.y, base + 0.0003);
        this.shellGroup.add(p);
      }

      // The roller's name stacked letter over letter beside it, on whatever
      // surface the drum stands on.
      if (t.labelVertical && t.labelAt) {
        const { texture, aspect } = stackedLabelTexture(t.label, '#eef1f5', { box: !!t.labelBox });
        const h = t.labelHeight ?? 0.016;
        const geo = new THREE.PlaneGeometry(h * aspect, h);
        const mat = new THREE.MeshPhysicalMaterial({
          map: texture, transparent: true, roughness: 0.5, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2,
        });
        this._disposables.push(geo, mat);
        const label = new THREE.Mesh(geo, mat);
        label.position.set(t.x + t.labelAt[0], t.y + t.labelAt[1], base + 0.00012);
        this.shellGroup.add(label);
      }
    }
  }

  /**
   * Raised housings standing on the face (Red Bull's roller pods beside the
   * grips): a rounded polygon extruded forward, in the grip's grey.
   */
  _buildPods() {
    const { shell, pods } = this.spec;
    for (const pod of pods ?? []) {
      // A part on the centreline (given as its right half, from x = 0 round
      // to x = 0) is one shape, not two halves meeting in a seam.
      const centred = pod.points[0][0] === 0 && pod.points.at(-1)[0] === 0;
      for (const side of centred ? [0] : [-1, 1]) {
        let pts = pod.points.map(([x, y]) => [side * x, y]);
        if (centred) {
          const right = pod.points;
          const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
          pts = [...right, ...left];
        }
        if (side < 0) pts.reverse();          // keep the winding anticlockwise
        const shape = roundedPolyShape(pts, pod.radius ?? 0.004);
        const bevel = Math.min(0.0018, pod.depth * 0.3);
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: pod.depth - bevel, bevelEnabled: true, bevelThickness: bevel,
          bevelSize: bevel, bevelSegments: 5, curveSegments: 10,
        });
        this._disposables.push(geo);
        // Extrusion UVs are in metres; a leather or rubber grain needs them
        // in something nearer its own scale, or it shows as coarse blotches.
        if (pod.material === 'rim' || pod.material === 'grip') {
          const uv = geo.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 40);
          uv.needsUpdate = true;
        }
        const rimMat = { silicone: this.materials.silicone, greySilicone: this.materials.greySilicone, leather: this.materials.leather }[this.spec.grip.rim?.material]
          ?? this.materials.grip;
        const mat = pod.material === 'grip' ? (this.spec.grip.material === 'silicone' ? this.materials.silicone : this.materials.grip)
          : pod.material === 'rim' ? rimMat
            : pod.material === 'gloss' ? this.materials.bezelBlack
              : pod.material === 'matte' ? this.materials.housingSatin : this.materials.podSatin;
        const mesh = new THREE.Mesh(geo, mat);
        // A moulding can start behind the face — a sim wheel's leather spokes
        // run behind its metal plate — by `z`.
        mesh.position.z = shell.frontZ - 0.0010 + (pod.z ?? 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.shellGroup.add(mesh);
      }
    }
  }

  /** A cap's material: a named anodised colour, or any hex sampled from a photo. */
  _capMaterial(colour) {
    if (this.materials.caps[colour]) return this.materials.caps[colour];
    if (typeof colour === 'string' && colour.startsWith('#')) {
      this._hexCaps ??= new Map();
      if (!this._hexCaps.has(colour)) {
        const m = new THREE.MeshPhysicalMaterial({
          color: colour, roughness: 0.42, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.25,
          envMapIntensity: 1.2,
        });
        this._hexCaps.set(colour, m);
        this._disposables.push(m);
      }
      return this._hexCaps.get(colour);
    }
    return this.materials.caps.black;
  }

  /**
   * A tall black pointer knob, as on Ferrari's selectors: a round boss with
   * an elongated grip standing on it, its long axis pointing at the
   * selected position.
   */
  _buildBatKnob(dial, r) {
    const h = r.height;
    const bossGeo = new THREE.CylinderGeometry(r.radius * 0.78, r.radius * 0.84, h * 0.32, 40);
    bossGeo.rotateX(Math.PI / 2);
    const len = r.radius * 2.5, wid = r.radius * 1.0;
    const shape = new THREE.Shape();
    const rr = wid / 2;
    shape.moveTo(-rr, -len / 2 + rr);
    shape.lineTo(-rr * 0.82, len / 2 - rr);
    shape.absarc(0, len / 2 - rr, rr * 0.82, Math.PI, 0, true);
    shape.lineTo(rr, -len / 2 + rr);
    shape.absarc(0, -len / 2 + rr, rr, 0, Math.PI, true);
    const bevel = Math.min(wid * 0.28, h * 0.22);
    const gripGeo = new THREE.ExtrudeGeometry(shape, {
      depth: h * 0.95 - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9,
      bevelSegments: 6, curveSegments: 16,
    });
    gripGeo.translate(0, 0, bevel);
    this._disposables.push(bossGeo, gripGeo);
    const boss = new THREE.Mesh(bossGeo, this.materials.knobBlack);
    boss.position.z = h * 0.16;
    dial.add(boss);
    const grip = new THREE.Mesh(gripGeo, this.materials.knobBlack);
    grip.castShadow = true;
    dial.add(grip);
    // Angles are clockwise from twelve o'clock.
    dial.rotation.z = -((r.pointAt ?? 0) * Math.PI) / 180;
  }

  /** Ferrari's centre rotary: a black cog ring round a yellow badge. */
  _buildEmblemKnob(dial, r) {
    const h = r.height;
    const gearGeo = new THREE.ExtrudeGeometry(knobShape(r.radius, r.lobes ?? 14, 0.16), {
      depth: h * 0.8, bevelEnabled: true, bevelThickness: h * 0.1, bevelSize: r.radius * 0.04,
      bevelSegments: 3, curveSegments: 4,
    });
    this._disposables.push(gearGeo);
    const gear = new THREE.Mesh(gearGeo, this.materials.knurlBlack);
    gear.castShadow = true;
    dial.add(gear);
    const discGeo = new THREE.CircleGeometry(r.radius * 0.72, 64);
    const discMat = new THREE.MeshPhysicalMaterial({
      map: emblemTexture(r.emblem ?? '#f6d21c'), roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.08,
    });
    this._disposables.push(discGeo, discMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.z = h + 0.0002;
    dial.add(disc);
  }

  /**
   * Small fittings on the face: indicator lenses, toggle switches and raised
   * label tabs.
   */
  _buildFittings() {
    const { shell } = this.spec;
    const z0 = shell.frontZ;
    for (const ind of this.spec.indicators ?? []) {
      const r = ind.radius ?? 0.0022;
      const ring = bezelGeometry(r * 1.0, r * 1.55, 0.0012);
      const lensGeo = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      lensGeo.rotateX(Math.PI / 2);
      lensGeo.scale(1, 1, 0.45);
      const col = new THREE.Color(ind.colour);
      const lensMat = new THREE.MeshPhysicalMaterial({
        color: col, emissive: col.clone().multiplyScalar(0.18), roughness: 0.15,
        clearcoat: 1.0, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9,
      });
      this._disposables.push(ring, lensGeo, lensMat);
      const lift = this._liftAt(ind.x, ind.y);
      const bz = new THREE.Mesh(ring, ind.bezel === 'chrome' ? this.materials.titanium : this.materials.bezelBlack);
      bz.position.set(ind.x, ind.y, z0 + lift);
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(ind.x, ind.y, z0 + 0.0004 + lift);
      this.shellGroup.add(bz, lens);
    }
    for (const t of this.spec.toggles ?? []) {
      const nutGeo = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0016, 6);
      nutGeo.rotateX(Math.PI / 2);
      const leverGeo = new THREE.CylinderGeometry(0.0010, 0.0008, 0.0085, 16);
      leverGeo.translate(0, 0.0042, 0);
      const tipGeo = new THREE.SphereGeometry(0.0013, 16, 10);
      this._disposables.push(nutGeo, leverGeo, tipGeo);
      const nut = new THREE.Mesh(nutGeo, this.materials.titanium);
      nut.position.set(t.x, t.y, z0 + 0.0008);
      const lever = new THREE.Group();
      lever.position.set(t.x, t.y, z0 + 0.0016);
      // Thrown towards one legend, standing out of the face.
      lever.rotation.x = Math.PI / 2 - 0.35;
      const stem = new THREE.Mesh(leverGeo, this.materials.titanium);
      const tip = new THREE.Mesh(tipGeo, this.materials.titanium);
      tip.position.y = 0.0086;
      lever.add(stem, tip);
      this.shellGroup.add(nut, lever);
    }
    for (const tb of this.spec.tabs ?? []) {
      const depth = tb.depth ?? 0.0040;
      const geo = plateGeometry(tb.w, tb.h, Math.min(tb.h * 0.3, 0.0015), depth, 0.0006);
      const mat = new THREE.MeshPhysicalMaterial({
        map: tabTextTexture(tb.text, tb.ink ?? '#ffffff', tb.w / tb.h, { fill: !!tb.fill }),
        roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.08, metalness: 0.1,
      });
      // The text texture goes on the front face only; the rest stays black.
      const black = this.materials.bezelBlack;
      this._disposables.push(geo, mat);
      // A tab can be turned (SOC, EB read down the side of the display), and
      // a plain one is just the white legend printed on the surface.
      const lift = this._liftAt(tb.x, tb.y);
      const holder = new THREE.Group();
      holder.position.set(tb.x, tb.y, z0 + lift + (tb.z ?? 0));
      holder.rotation.z = ((tb.angle ?? 0) * Math.PI) / 180;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(tb.w * 0.94, tb.h * 0.9), mat);
      this._disposables.push(face.geometry);
      if (tb.plain) {
        mat.transparent = true;
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        face.position.z = 0.00015;
        holder.add(face);
      } else {
        const block = new THREE.Mesh(geo, black);
        block.position.z = depth / 2;
        block.castShadow = true;
        face.position.z = depth + 0.0007;
        holder.add(block, face);
      }
      this.shellGroup.add(holder);
    }
  }

  /** The Red Bull rotary: bezel, anodised collar, knurled knob, printed crown. */
  _buildCollarRotary(dial, r) {
    const cr = r.collarRadius ?? r.radius * 1.5;
    const bezelH = 0.0022, collarH = r.collarHeight ?? 0.0055, knobH = r.knobHeight ?? 0.0095;

    const bezel = bezelGeometry(cr * 1.0, cr * 1.16, bezelH);
    this._disposables.push(bezel);
    const bz = new THREE.Mesh(bezel, this.materials.bezelBlack);
    bz.position.z = 0.0010;
    dial.add(bz);

    // The collar: a short cylinder with a chamfered top edge, so the ring of
    // anodise catches a bright line where it turns over.
    // Lathed along +y; turned so it stands out of the face (+z).
    const collarGeo = rotaryBodyGeometry(cr * 0.98, collarH, { chamfer: 0.18, segments: 64 });
    collarGeo.rotateX(Math.PI / 2);
    const collarMat = new THREE.MeshPhysicalMaterial({
      color: r.collar, metalness: 0.78, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2,
      envMapIntensity: 1.4,
    });
    this._disposables.push(collarGeo, collarMat);
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.castShadow = true;
    dial.add(collar);

    // Knurled black knob: the flank carries the knurl, the crown is smooth.
    const flankGeo = new THREE.CylinderGeometry(r.radius, r.radius * 1.02, knobH * 0.86, 56, 1, true);
    flankGeo.rotateX(Math.PI / 2);
    const capGeo = rotaryBodyGeometry(r.radius, knobH * 0.16, { chamfer: 0.5, segments: 56 });
    capGeo.rotateX(Math.PI / 2);
    this._disposables.push(flankGeo, capGeo);
    const flank = new THREE.Mesh(flankGeo, this.materials.knurlBlack);
    flank.position.z = collarH + knobH * 0.43;
    flank.castShadow = true;
    dial.add(flank);
    const crown = new THREE.Mesh(capGeo, this.materials.knobBlack);
    crown.position.z = collarH + knobH * 0.84;
    dial.add(crown);

    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(r.radius * 1.9, r.radius * 1.9),
      new THREE.MeshPhysicalMaterial({
        map: capLegendTexture(r.legend ?? r.label, '#f1f3f6'), transparent: true,
        roughness: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }),
    );
    decal.position.z = collarH + knobH + 0.0002;
    this._disposables.push(decal.geometry, decal.material);
    dial.add(decal);
  }

  /* ───────────────────────────── display ────────────────────────────── */

  _buildDisplay() {
    const { screen, shell } = this.spec;
    // No screen on this wheel: nothing to build, nothing to update.
    if (!screen) { this.display = null; this.screenGlow = null; return; }
    this.display = new Display(screen);

    // A display module — Mercedes — is a block of black glass standing proud
    // of the carbon, with the screen and the shift lights inside it.
    // Everything in the module sits on its front face: its depth plus the
    // bevel that rounds its edge, or the glass covers the screen.
    const lift = screen.module ? screen.module.depth + MODULE_BEVEL : 0;
    if (screen.module) {
      const m = screen.module;
      const top = screen.y + screen.height / 2 + screen.bezelTop;
      const bottom = screen.y - screen.height / 2 - screen.bezelBottom;
      const moduleGeo = plateGeometry(screen.width + screen.bezel * 2, top - bottom,
        m.radius, m.depth, MODULE_BEVEL);
      this._disposables.push(moduleGeo);
      // Red Bull's is a satin black housing rather than glass.
      const glassBlock = new THREE.Mesh(moduleGeo, m.finish === 'satin' ? this.materials.housingSatin
        : m.finish === 'carbon' ? this.materials.carbonPlain : this.materials.moduleGlass);
      glassBlock.position.set(screen.x, (top + bottom) / 2, shell.frontZ + m.depth / 2);
      glassBlock.castShadow = true;
      this.shellGroup.add(glassBlock);
      // A housing wider at the top, round the shift lights, than at its neck.
      if (m.upper) {
        const upGeo = plateGeometry(m.upper.halfWidth * 2, top - m.upper.bottom, m.radius, m.depth, MODULE_BEVEL);
        this._disposables.push(upGeo);
        const up = new THREE.Mesh(upGeo, glassBlock.material);
        up.position.set(screen.x, (top + m.upper.bottom) / 2, shell.frontZ + m.depth / 2);
        up.castShadow = true;
        this.shellGroup.add(up);
      }
    }

    // On a carbon housing the lights sit in black windows of their own, and
    // the glass in a thin black frame.
    if (screen.module?.finish === 'carbon') {
      const { lightBar } = this.spec;
      const plates = [[0, lightBar.y, lightBar.width + 0.002, lightBar.height]];
      if (lightBar.flags === 'stacked') {
        const ys = lightBar.flagYs;
        const span = Math.max(...ys) - Math.min(...ys);
        for (const sx of [-1, 1]) plates.push([sx * lightBar.flagX, (Math.max(...ys) + Math.min(...ys)) / 2, 0.0064, span + 0.0080]);
      }
      plates.push([screen.x, screen.y, screen.width + 0.0030, screen.height + 0.0030]);
      for (const [x, y, w, h] of plates) {
        const g = plateGeometry(w, h, Math.min(0.0015, h / 3), 0.0004, 0.0001);
        this._disposables.push(g);
        const p = new THREE.Mesh(g, this.materials.bezelBlack);
        p.position.set(x, y, shell.frontZ + lift + 0.0002);
        this.shellGroup.add(p);
      }
    }

    const panelGeo = new THREE.PlaneGeometry(screen.width, screen.height);
    this._disposables.push(panelGeo);
    const panel = new THREE.Mesh(panelGeo, this.display.material);
    panel.position.set(screen.x, screen.y, shell.frontZ + lift + 0.0007);
    panel.castShadow = false;
    this.shellGroup.add(panel);

    const glassGeo = plateGeometry(screen.width + 0.0035, screen.height + 0.0035, screen.radius, 0.0011);
    this._disposables.push(glassGeo);
    const glass = new THREE.Mesh(glassGeo, this.materials.screenGlass);
    glass.position.set(screen.x, screen.y, shell.frontZ + lift + 0.0016);
    glass.renderOrder = 2;
    glass.castShadow = false;
    this.shellGroup.add(glass);

    // Sits on the panel's axis but well forward and dim, so it washes the
    // surrounding carbon without either blowing a highlight into the glass
    // or hanging in the bottom cut-out where there is nothing to light.
    this.screenGlow = new THREE.PointLight(0x8fd0ff, 0.013, 0.15, 2);
    this.screenGlow.position.set(screen.x, screen.y, shell.frontZ + lift + 0.034);
    this.shellGroup.add(this.screenGlow);
  }

  _buildRevLights() {
    if (!this.spec.lightBar) { this.revLights = null; return; }
    this.revLights = new RevLights(this.materials, this.spec);
    this.shellGroup.add(this.revLights.group);
  }

  /* ───────────────────────────── paddles ────────────────────────────── */

  _buildPaddles() {
    const { carbonPlain, titanium } = this.materials;
    this.paddles = new Map();
    const pivotGeo = new THREE.CylinderGeometry(0.0040, 0.0040, 0.0105, 20);
    this._disposables.push(pivotGeo);

    for (const p of this.spec.paddles) {
      const length = p.outerX - p.innerX;
      const geo = plateGeometry(length, p.height, 0.0055, 0.0030);
      this._disposables.push(geo);

      // Sweep the plate into an arc so the outer tip wraps toward the
      // driver's fingertips. A flat plate here reads as a slab of packaging,
      // not a part you could actually pull.
      const pos = geo.attributes.position;
      const half = length / 2;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const t = (x + half) / length;
        const arc = t * t * (3 - 2 * t);
        pos.setZ(i, pos.getZ(i) + p.bend * arc);
        pos.setY(i, pos.getY(i) - p.height * 0.16 * arc);
        pos.setY(i, pos.getY(i) * (1 - 0.22 * arc));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      // Hinged rather than simply placed, so it can be pulled. The hinge sits
      // at the inboard root, which is where the real pivot is, so the tip
      // swings toward the driver and the root stays put.
      const pivotX = p.wishbone ? -length / 2 : p.side * p.innerX;
      const hinge = new THREE.Group();
      hinge.position.set(pivotX, p.y, p.z);
      hinge.rotation.y = p.wishbone ? 0 : p.side * -0.14;

      const paddle = new THREE.Mesh(geo, p.material === 'alu' ? this.materials.aluDark : carbonPlain);
      paddle.position.x = p.wishbone ? length / 2 : (p.side * length) / 2;
      if (p.side < 0 && !p.wishbone) paddle.scale.x = -1;
      paddle.name = p.id;
      hinge.add(paddle);
      this.group.add(hinge);

      this.paddles.set(p.id, {
        def: p, hinge, base: hinge.rotation.y, baseZ: hinge.position.z, pull: 0,
      });

      // A wishbone hinges on one side rather than at an inboard root.
      const pivot = new THREE.Mesh(pivotGeo, titanium);
      pivot.rotation.z = Math.PI / 2;
      pivot.position.set(
        p.wishbone ? -length / 2 - 0.0040 : p.side * (p.innerX - 0.0040),
        p.y, p.z + 0.0040,
      );
      this.group.add(pivot);
    }
  }

  /* ─────────────────────────── back hardware ────────────────────────── */

  /**
   * What is actually bonded to the back of a wheel: stiffening ribs out to
   * the paddle mounts, the loom connector, and the cable runs feeding it. A
   * bare sheet of weave back here is the giveaway that nothing is wired up.
   */
  _buildBackDetail() {
    const { carbonBack, titanium, anodisedBlack } = this.materials;
    const { shell } = this.spec;
    const z = shell.backZ;

    const ribGeo = plateGeometry(0.0620, 0.0120, 0.0030, 0.0055);
    this._disposables.push(ribGeo);
    for (const side of [-1, 1]) {
      for (const y of [0.0345, -0.0340]) {
        const rib = new THREE.Mesh(ribGeo, carbonBack);
        rib.position.set(side * 0.0690, y, z - 0.0030);
        this.group.add(rib);
      }
    }

    const blockGeo = plateGeometry(0.0260, 0.0165, 0.0022, 0.0105);
    this._disposables.push(blockGeo);
    const block = new THREE.Mesh(blockGeo, anodisedBlack);
    block.position.set(0, shell.topY - 0.0400, z - 0.0055);
    this.group.add(block);

    const ringGeo = new THREE.CylinderGeometry(0.0062, 0.0062, 0.0115, 18);
    ringGeo.rotateX(Math.PI / 2);
    this._disposables.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, titanium);
    ring.position.set(0, shell.topY - 0.0400, z - 0.0125);
    this.group.add(ring);

    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, shell.topY - 0.0470, z - 0.0125),
      new THREE.Vector3(0.0125, shell.topY - 0.0630, z - 0.0180),
      new THREE.Vector3(0.0180, shell.topY - 0.0820, z - 0.0165),
      new THREE.Vector3(0.0120, shell.topY - 0.0940, z - 0.0120),
    ]);
    const loomGeo = new THREE.TubeGeometry(path, 28, 0.0034, 10, false);
    this._disposables.push(loomGeo);
    this.group.add(new THREE.Mesh(loomGeo, anodisedBlack));

    const clipGeo = new THREE.TorusGeometry(0.0042, 0.0011, 8, 16);
    this._disposables.push(clipGeo);
    for (const t of [0.30, 0.68]) {
      const clip = new THREE.Mesh(clipGeo, titanium);
      clip.position.copy(path.getPointAt(t));
      clip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), path.getTangentAt(t));
      this.group.add(clip);
    }
  }

  /* ─────────────────────────── hub & column ─────────────────────────── */

  _buildHub() {
    const { carbonPlain, titanium, anodisedBlack, dialFlank } = this.materials;
    const hub = new THREE.Group();
    const backZ = this.spec.shell.backZ;

    const add = (geo, material) => {
      this._disposables.push(geo);
      const m = new THREE.Mesh(geo, material);
      hub.add(m);
      return m;
    };

    const shroud = add(new THREE.CylinderGeometry(0.0360, 0.0320, 0.0300, 40, 1, true), carbonPlain);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = -0.0260;

    const backPlate = add(new THREE.CircleGeometry(0.0360, 40), carbonPlain);
    backPlate.position.z = backZ - 0.0055;
    backPlate.rotation.y = Math.PI;

    // Quick-release collar — the ring the driver pulls to pop the wheel off.
    const collar = add(new THREE.CylinderGeometry(0.0335, 0.0335, 0.0105, 40), titanium);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = -0.0465;

    const knurlRing = add(new THREE.CylinderGeometry(0.0345, 0.0345, 0.0062, 60, 1, true), dialFlank);
    knurlRing.rotation.x = Math.PI / 2;
    knurlRing.position.z = -0.0465;

    // Long enough to reach the bench stand behind it.
    const shaft = add(new THREE.CylinderGeometry(0.0158, 0.0175, 0.4050, 28), anodisedBlack);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.2450;

    const bossGeo = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0075, 14);
    bossGeo.rotateX(Math.PI / 2);
    this._disposables.push(bossGeo);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const boss = new THREE.Mesh(bossGeo, titanium);
      boss.position.set(Math.cos(a) * 0.0285, Math.sin(a) * 0.0285, -0.0140);
      hub.add(boss);
    }

    this.group.add(hub);
    this.hub = hub;
  }

  /* ──────────────────────────── behaviour ───────────────────────────── */

  /** @param {number} radians positive turns the wheel to the driver's right */
  setAngle(radians) {
    this.angle = radians;
    this.group.rotation.z = -radians;
  }

  /** Momentarily depresses a button cap — used when telemetry fires an event. */
  press(id) {
    const b = this.buttons.get(id);
    if (b) b.press = 1;
  }

  /**
   * Turns a rotary by whole detents — positive clockwise — as its real twin
   * was turned, and remembers where it is. Its travel ends where the real
   * switch's does; an endless encoder (no `detents`) just keeps going.
   */
  turn(id, steps) {
    const r = this.rotaries.get(id);
    if (!r || !steps) return;
    const def = r.def;
    const n = def.detents ?? 12;
    const before = def.value ?? 1;
    def.value = def.endless ? before + steps : Math.max(1, Math.min(n, before + steps));
    const moved = def.value - before;
    if (!moved) return;
    // A full-circle dial (a printed band, a pointer knob) steps by a twelfth
    // of a turn per position; a swept scale by its share of ~295°.
    const step = def.band || def.knobStyle ? (Math.PI * 2) / n : (Math.PI * 2 * 0.82) / Math.max(1, n - 1);
    r.dial.rotation.z -= moved * step;
  }

  /**
   * Pulls a gear flap, which snaps back on its own.
   * @param {string} id one of the ids in the team's paddle list
   */
  pull(id) {
    const p = this.paddles.get(id);
    if (p) p.pull = 1;
  }

  /** @param {-1|1} direction  −1 downshift, +1 upshift */
  pullShiftPaddle(direction) {
    this.pull(direction > 0 ? 'upshift' : 'downshift');
  }

  update(dt, telemetry = {}) {
    this.display?.update(dt, telemetry);
    this.revLights?.update(dt, telemetry.rpmFraction ?? 0, telemetry.flag ?? 'none');

    if (this.screenGlow) this.screenGlow.intensity = 0.012 + 0.004 * Math.sin(performance.now() * 0.0012);

    // A d-pad's four directions share one cross: it rocks toward whichever
    // are pressed, gathered first so they do not undo each other.
    const rocks = new Map();
    for (const b of this.buttons.values()) {
      if (b.rock) {
        const r = rocks.get(b.cap) ?? { x: 0, y: 0, z: 0, restZ: b.restZ };
        const k = b.press * 0.16;
        if (b.rock === 'up') r.x -= k;
        if (b.rock === 'down') r.x += k;
        if (b.rock === 'left') r.y -= k;
        if (b.rock === 'right') r.y += k;
        r.z = Math.max(r.z, b.press);
        rocks.set(b.cap, r);
        b.press = Math.max(0, b.press - dt * 6);
        continue;
      }
      if (b.press > 0) {
        b.press = Math.max(0, b.press - dt * 6);
        b.cap.position.z = b.restZ - 0.0016 * b.press;
      }
    }
    for (const [cap, r] of rocks) {
      cap.rotation.x = r.x;
      cap.rotation.y = r.y;
      cap.position.z = r.restZ - 0.0006 * r.z;
    }

    for (const p of this.paddles.values()) {
      if (p.pull <= 0) continue;
      p.pull = Math.max(0, p.pull - dt * 7);
      // Ease out, so the flap snaps and returns rather than sliding.
      const travel = p.pull * p.pull * (3 - 2 * p.pull);
      if (p.def.wishbone) {
        p.hinge.position.z = p.baseZ + 0.0085 * travel;
      } else {
        p.hinge.rotation.y = p.base - p.def.side * 0.30 * travel;
      }
    }
  }

  /** Releases this wheel's geometry. Materials belong to the caller. */
  dispose() {
    this.group.removeFromParent();
    for (const geo of this._disposables) geo.dispose();
    this._disposables.length = 0;
    this.display?.dispose();
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

/**
 * The rim of a round wheel. Its centreline is a circle of `radius`, or the
 * closed outline `path` ([x, y] points, any order round, joined smoothly);
 * its section is a rounded rectangle `width` across (in the wheel's plane)
 * by `depth` front to back, squared off by `squareness` (2 an ellipse,
 * higher flatter-sided). Faces carry material group 0, or 1 + the index of
 * the band in `bands` ({from, to} in degrees clockwise from twelve o'clock)
 * their angle falls in.
 */
function buildRimGeometry(rim, { steps = 240, radial = 28 } = {}) {
  const centre = (t) => {
    if (rim.path) return rimPathPoint(rim.path, t);
    // t from 0 at twelve o'clock, clockwise.
    const a = Math.PI / 2 - t * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a) * rim.radius, Math.sin(a) * rim.radius);
  };
  const n = rim.squareness ?? 2.6;
  const hw = rim.width / 2, hd = rim.depth / 2;
  const positions = [], uvs = [], indices = [];
  const ring = radial + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = centre(t);
    const ahead = centre((i + 1) / steps), behind = centre((i - 1 + steps) / steps);
    const tangent = ahead.clone().sub(behind).normalize();
    // Clockwise travel: the outward normal is the tangent turned left.
    const out = new THREE.Vector2(-tangent.y, tangent.x);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const ez = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      positions.push(p.x + out.x * ex * hw, p.y + out.y * ex * hw, ez * hd);
      uvs.push(t * 24, j / radial);
    }
  }
  const bandOf = (t) => {
    const deg = t * 360;
    const k = (rim.bands ?? []).findIndex((b) => (b.from <= b.to ? deg >= b.from && deg < b.to : deg >= b.from || deg < b.to));
    return k + 1;
  };
  const groups = [];
  for (let i = 0; i < steps; i++) {
    const g = bandOf((i + 0.5) / steps);
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const last = groups.at(-1);
    if (last && last.g === g) last.count += radial * 6;
    else groups.push({ g, start: i * radial * 6, count: radial * 6 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  for (const { g, start, count } of groups) geo.addGroup(start, count, g);
  return geo;
}

/** A point at fraction `t` of the way round a closed outline, by arc length. */
const rimCurves = new WeakMap();
function rimPathPoint(path, t) {
  let curve = rimCurves.get(path);
  if (!curve) {
    const pts = path.map(([x, y]) => new THREE.Vector2(x, y));
    curve = new THREE.SplineCurve([...pts, pts[0]]);
    rimCurves.set(path, curve);
  }
  return curve.getPointAt(((t % 1) + 1) % 1);
}

/**
 * A raised ring round a button or rotary: a lathed profile with a rounded
 * outer shoulder and a small inner lip, standing `height` off the face.
 */
function bezelGeometry(inner, outer, height) {
  const pts = [];
  const shoulder = Math.min(height * 0.7, (outer - inner) * 0.45);
  pts.push(new THREE.Vector2(outer, 0));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI / 2;
    pts.push(new THREE.Vector2(outer - shoulder + Math.cos(a) * shoulder, height - shoulder + Math.sin(a) * shoulder));
  }
  pts.push(new THREE.Vector2(inner + 0.0003, height));
  pts.push(new THREE.Vector2(inner, height - 0.0004));
  pts.push(new THREE.Vector2(inner, 0));
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * Re-sorts an ExtrudeGeometry's triangles into three material groups —
 * front cap, side walls, back cap — so each can take its own material.
 */
function splitExtrudeGroups(geo) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const vertexOf = index ? (i) => index.getX(i) : (i) => i;
  const triCount = index ? index.count : pos.count;

  // The cap planes are NOT at 0 and `depth` — bevelling pushes them out by
  // the bevel thickness — so measure where they actually landed.
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }

  const eps = (zMax - zMin) * 1e-3;
  const front = [], wall = [], back = [];

  for (let i = 0; i < triCount; i += 3) {
    const a = vertexOf(i), b = vertexOf(i + 1), c = vertexOf(i + 2);
    const za = pos.getZ(a), zb = pos.getZ(b), zc = pos.getZ(c);
    const atFront = za > zMax - eps && zb > zMax - eps && zc > zMax - eps;
    const atBack = za < zMin + eps && zb < zMin + eps && zc < zMin + eps;
    (atFront ? front : atBack ? back : wall).push(a, b, c);
  }

  geo.setIndex([...front, ...wall, ...back]);
  geo.clearGroups();
  geo.addGroup(0, front.length, 0);
  geo.addGroup(front.length, wall.length, 1);
  geo.addGroup(front.length + wall.length, back.length, 2);
  return geo;
}

/**
 * Sweeps one hand grip and fairs it into the shell.
 *
 * Built with fixed world axes rather than Frenet frames — the curve is close
 * to straight, where Frenet normals flip unpredictably. The cross-section is
 * a superellipse so the grip is flat against the palm and round at the
 * fingers, tapering to blunt ends and pinched by moulded finger grooves on
 * the outboard face.
 *
 * The back of the grip is simply buried inside the shell, which is both what
 * a one-piece moulding looks like and the robust way to model it. Folding
 * those vertices onto the face instead — the obvious way to fake a moulded
 * foot — collapses them: at the very back of the section the sideways offset
 * is near zero, so a whole band of vertices lands on the same point and the
 * degenerate triangles tear into black slivers.
 *
 * @param {-1|1} side
 */
function buildGripGeometry(side, grip, shell, { steps = 110, radial = 44 } = {}) {
  const positions = [], uvs = [], indices = [];
  const ring = radial + 1;
  // Closer to an ellipse than a squircle: at 3.4 the section is so flat
  // that the grip reads as a plate stuck on the fascia rather than a handle.
  const n = 2.5;
  const span = grip.topY - grip.bottomY;

  const grooveCentres = [];
  for (let i = 0; i < grip.fingerGrooves; i++) {
    grooveCentres.push(0.28 + (i / (grip.fingerGrooves - 1)) * 0.56);
  }

  // Blunt ends: near-full section along almost the whole handle, closing
  // quickly at the caps. A plain sine taper leaves the grip looking inflated
  // in the middle and pointed at the tips.
  const roundEnds = (t) => Math.pow(1 - Math.pow(Math.abs(2 * t - 1), 7), 0.42);
  // A grip whose top runs up into the body (Mercedes) only closes at the
  // bottom; its top end is buried under the corner of the wheel.
  const taper = grip.openTop
    ? (t) => (t < 0.5 ? 1 : roundEnds(t))
    : roundEnds;

  // A measured grip gives its centreline and width at a list of heights —
  // a gentle banana, wide at the top where it tucks under the corner and
  // narrowing toward the bottom — interpolated smoothly between them.
  const profileAt = (y) => {
    const pts = grip.profile;
    if (!pts) return null;
    if (y >= pts[0][0]) return { x: pts[0][1], hw: pts[0][2] };
    for (let i = 0; i < pts.length - 1; i++) {
      const [y0, x0, w0] = pts[i], [y1, x1, w1] = pts[i + 1];
      if (y <= y0 && y >= y1) {
        const u = (y0 - y) / (y0 - y1);
        const s = u * u * (3 - 2 * u);
        return { x: x0 + (x1 - x0) * s, hw: w0 + (w1 - w0) * s };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last[1], hw: last[2] };
  };

  // A sleeve over the lower part (Red Bull) stands a little proud of the
  // upper grip, so the joint reads as a step.
  const sleeveAt = (y) => (grip.split && y < grip.split.y ? 1 + (grip.split.proud ?? 0.05) : 1);

  const groove = (t) => {
    let g = 0;
    for (const c of grooveCentres) {
      const d = (t - c) / 0.040;
      g += Math.exp(-d * d);
    }
    return Math.min(1, g);
  };

  // Fingers wrap the outboard-rear quadrant, so that is where the moulding
  // bites deepest. Theta is measured in world axes, so the target angle has
  // to mirror with the side.
  const grooveAxis = side > 0 ? -Math.PI / 4 : Math.PI * 1.25;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cy = grip.topY - span * t;
    const prof = profileAt(cy);
    const cx = side * (prof ? prof.x : grip.centreX + grip.bowX * Math.sin(Math.PI * t));
    const cz = grip.z + grip.zRakeTop * (1 - t);

    const k = taper(t);
    const gk = groove(t);

    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      const c = Math.cos(theta), sn = Math.sin(theta);
      const p = 2 / n;
      const ex = Math.sign(c) * Math.pow(Math.abs(c), p);
      const ey = Math.sign(sn) * Math.pow(Math.abs(sn), p);

      const wrap = 0.5 + 0.5 * Math.cos(theta - grooveAxis);
      const shrink = 1 - 0.105 * gk * (0.25 + 0.75 * wrap);

      const sv = sleeveAt(cy);
      const hw = (prof ? prof.hw : grip.halfWidth) * k * shrink * sv;
      const hd = grip.halfDepth * k * shrink * sv;

      positions.push(cx + ex * hw, cy, cz + ey * hd);
      uvs.push(j / radial, t * 3.2);
    }
  }

  // Winding matters: rings run top to bottom while theta runs anticlockwise
  // about the grip's axis, so (a, b, a+1) traces each triangle the wrong way
  // and `computeVertexNormals` then points every normal into the grip. The
  // result still draws — you are simply looking at the inside of the surface,
  // lit from within, which reads as a dark torn shape rather than a handle.
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (grip.split) {
    // Rows above the joint take the grip's own material, rows below the
    // sleeve's.
    let row = steps;
    for (let i = 0; i < steps; i++) {
      if (grip.topY - span * ((i + 0.5) / steps) < grip.split.y) { row = i; break; }
    }
    geo.addGroup(0, row * radial * 6, 0);
    geo.addGroup(row * radial * 6, (steps - row) * radial * 6, 1);
  }
  return geo;
}
