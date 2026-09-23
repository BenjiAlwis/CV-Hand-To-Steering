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
import { planarUV, buttonCapGeometry, rotaryBodyGeometry, plateGeometry } from './geometry.js';
import { Display } from './display.js';
import { RevLights } from './revlights.js';
import { CAP_COLOURS } from './caps.js';

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
    this._buildSwitchgear();
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
      bevelSegments: 3,
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
    for (const [x, y] of [
      [-shell.topCornerX * 0.28, shell.topY - inset],
      [shell.topCornerX * 0.28, shell.topY - inset],
      [-shell.shoulderX + inset * 1.5, shell.shoulderY],
      [shell.shoulderX - inset * 1.5, shell.shoulderY],
      [-shell.legOuterX + inset, shell.legBottomY + inset * 1.6],
      [shell.legOuterX - inset, shell.legBottomY + inset * 1.6],
    ]) {
      const bolt = new THREE.Mesh(boltGeo, titanium);
      bolt.position.set(x, y, shell.frontZ + 0.0006);
      this.shellGroup.add(bolt);
    }
  }

  /* ────────────────────────────── grips ─────────────────────────────── */

  _buildGrips() {
    const { grip, shell } = this.spec;

    for (const side of [-1, 1]) {
      const geo = buildGripGeometry(side, grip, shell);
      this._disposables.push(geo);
      const mesh = new THREE.Mesh(geo, this.materials.grip);
      mesh.name = `grip${side < 0 ? 'L' : 'R'}`;
      this.group.add(mesh);

      // Moulded rubber thumb rest on the driver-facing inboard quadrant.
      const pad = grip.thumbPad;
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

      this._buildThumbControls(side);
    }
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

    // Shared geometry — every face button is the same part number.
    const capGeo = buttonCapGeometry(buttons[0].radius, buttons[0].height);
    capGeo.rotateX(Math.PI / 2);
    const collarGeo = new THREE.CylinderGeometry(
      buttons[0].radius * 1.19, buttons[0].radius * 1.19, 0.0010, 28, 1, true,
    );
    collarGeo.rotateX(Math.PI / 2);
    this._disposables.push(capGeo, collarGeo);

    for (const b of buttons) {
      const cap = new THREE.Mesh(capGeo, this.materials.caps[b.colour] ?? this.materials.caps.black);
      cap.position.set(b.x, b.y, shell.frontZ - 0.0021);
      cap.userData.id = b.id;
      this.shellGroup.add(cap);

      const collar = new THREE.Mesh(collarGeo, titanium);
      collar.position.set(b.x, b.y, shell.frontZ - 0.0006);
      this.shellGroup.add(collar);

      this.buttons.set(b.id, { def: b, cap, restZ: cap.position.z, press: 0 });
    }

    for (const r of rotaries) {
      const dial = new THREE.Group();
      dial.position.set(r.x, r.y, shell.frontZ - 0.0010);

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

  /* ───────────────────────────── display ────────────────────────────── */

  _buildDisplay() {
    const { screen, shell } = this.spec;
    this.display = new Display(screen);

    const panelGeo = new THREE.PlaneGeometry(screen.width, screen.height);
    this._disposables.push(panelGeo);
    const panel = new THREE.Mesh(panelGeo, this.display.material);
    panel.position.set(screen.x, screen.y, shell.frontZ + 0.0007);
    panel.castShadow = false;
    this.shellGroup.add(panel);

    const glassGeo = plateGeometry(screen.width + 0.0035, screen.height + 0.0035, screen.radius, 0.0011);
    this._disposables.push(glassGeo);
    const glass = new THREE.Mesh(glassGeo, this.materials.screenGlass);
    glass.position.set(screen.x, screen.y, shell.frontZ + 0.0016);
    glass.renderOrder = 2;
    glass.castShadow = false;
    this.shellGroup.add(glass);

    // Sits on the panel's axis but well forward and dim, so it washes the
    // surrounding carbon without either blowing a highlight into the glass
    // or hanging in the bottom cut-out where there is nothing to light.
    this.screenGlow = new THREE.PointLight(0x8fd0ff, 0.013, 0.15, 2);
    this.screenGlow.position.set(screen.x, screen.y, shell.frontZ + 0.034);
    this.shellGroup.add(this.screenGlow);
  }

  _buildRevLights() {
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

      const paddle = new THREE.Mesh(geo, carbonPlain);
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
    this.display.update(dt, telemetry);
    this.revLights.update(dt, telemetry.rpmFraction ?? 0, telemetry.flag ?? 'none');

    this.screenGlow.intensity = 0.012 + 0.004 * Math.sin(performance.now() * 0.0012);

    for (const b of this.buttons.values()) {
      if (b.press > 0) {
        b.press = Math.max(0, b.press - dt * 6);
        b.cap.position.z = b.restZ - 0.0016 * b.press;
      }
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
    this.display.dispose();
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

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
  const taper = (t) => Math.pow(1 - Math.pow(Math.abs(2 * t - 1), 7), 0.42);

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
    const cx = side * (grip.centreX + grip.bowX * Math.sin(Math.PI * t));
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

      const hw = grip.halfWidth * k * shrink;
      const hd = grip.halfDepth * k * shrink;

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
  return geo;
}
