/**
 * The bay the wheel sits in.
 *
 * A dark engineering studio: polished concrete, an infinity cove, and an
 * overhead lighting rig. The image-based lighting is baked from a miniature
 * of that same rig, so what you see reflected in the carbon and the titanium
 * is what is actually hanging above the wheel — the single biggest thing
 * separating a plausible render from a flat one.
 */
import * as THREE from 'three';
import { concrete, normalMapFromHeight, colorTexture, dataTexture } from '../textures/procedural.js';

const COVE_VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COVE_FRAG = /* glsl */`
  varying vec3 vWorld;
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 horizon;
  uniform float height;
  void main() {
    float h = clamp((vWorld.y + height * 0.35) / height, 0.0, 1.0);
    vec3 col = mix(bottom, horizon, smoothstep(0.0, 0.42, h));
    col = mix(col, top, smoothstep(0.42, 1.0, h));
    // Slight falloff away from centre keeps the cove from reading as a wall.
    float d = length(vWorld.xz) / 9.0;
    col *= 1.0 - 0.35 * clamp(d - 0.35, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Environment {
  constructor(renderer, scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildCove();
    this._buildFloor();
    this._buildRig();
    this._buildLights();
    this._buildStand();
    this._buildDust();

    scene.environment = this._bakeIBL(renderer);
    scene.environmentIntensity = 1.0;
    scene.fog = new THREE.FogExp2(0x070a0e, 0.30);
  }

  /* ─────────────────────────── infinity cove ────────────────────────── */

  _buildCove() {
    const geo = new THREE.SphereGeometry(9.5, 48, 32);
    const mat = new THREE.ShaderMaterial({
      vertexShader: COVE_VERT,
      fragmentShader: COVE_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x0d1219) },
        horizon: { value: new THREE.Color(0x1f2937) },
        bottom: { value: new THREE.Color(0x070a0e) },
        height: { value: 9.0 },
      },
    });
    const cove = new THREE.Mesh(geo, mat);
    cove.renderOrder = -1;
    this.group.add(cove);
  }

  /* ──────────────────────────── the floor ───────────────────────────── */

  _buildFloor() {
    const tex = concrete({ size: 1024, seed: 77 });
    const normal = normalMapFromHeight(tex.height, 0.9);

    const map = colorTexture(tex.color, 10);
    const rough = dataTexture(tex.roughness, 10);
    const norm = dataTexture(normal, 10);

    const mat = new THREE.MeshPhysicalMaterial({
      map,
      roughnessMap: rough,
      normalMap: norm,
      normalScale: new THREE.Vector2(0.22, 0.22),
      color: 0x2e343f,
      roughness: 1.0,
      metalness: 0.0,
      // Barely any specular: at this camera height the floor is seen almost
      // edge-on, where Fresnel drives reflectance toward 1 and a normal
      // dielectric floor turns into a mirror of the ceiling rig.
      specularIntensity: 0.22,
      clearcoat: 0.0,
      envMapIntensity: 0.22,
    });

    // Set well below the rig: at a 32° lens 60 cm from the wheel, a closer
    // floor swallows the frame and the subject stops reading as the subject.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.95;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floor = floor;

    // Painted inspection box around the rig.
    // Painted inspection box around the rig.
    const box = new THREE.Mesh(
      new THREE.RingGeometry(1.46, 1.52, 4, 1),
      new THREE.MeshBasicMaterial({ color: 0x2a313c, transparent: true, opacity: 0.22 }),
    );
    box.rotation.x = -Math.PI / 2;
    box.rotation.z = Math.PI / 4;
    box.position.y = -0.948;
    this.group.add(box);
  }

  /* ──────────────────────── visible lighting rig ────────────────────── */

  _buildRig() {
    const bar = (w, h, d, colour, intensity) => new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(intensity), toneMapped: false }),
    );

    // Overhead softbox strips — the main highlight sources on the carbon.
    const strips = [
      { pos: [-0.85, 1.95, 0.55], size: [0.12, 0.035, 2.4], colour: 0xdce9ff, i: 2.6, rot: 0 },
      { pos: [0.85, 1.95, 0.55], size: [0.12, 0.035, 2.4], colour: 0xdce9ff, i: 2.6, rot: 0 },
      { pos: [0, 2.15, -1.4], size: [3.4, 0.035, 0.10], colour: 0xbcd4ff, i: 1.7, rot: 0 },
    ];
    for (const s of strips) {
      const m = bar(...s.size, s.colour, s.i);
      m.position.set(...s.pos);
      this.group.add(m);

      // Housing so the strips don't float as bare glowing slabs.
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(s.size[0] * 1.7, 0.055, s.size[2] * 1.03),
        new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.5, metalness: 0.8 }),
      );
      housing.position.set(s.pos[0], s.pos[1] + 0.045, s.pos[2]);
      this.group.add(housing);
    }

    // Cool accent strips low and behind, for rim separation.
    // Cool kickers stay high and well behind — anything near the floor line
    // reads as a horizon and flattens the whole shot.
    const accents = [
      { pos: [-2.9, 0.75, -3.2], size: [0.035, 1.9, 0.035], colour: 0x2f9dd6, i: 2.2 },
      { pos: [2.9, 0.75, -3.2], size: [0.035, 1.9, 0.035], colour: 0x2f9dd6, i: 2.2 },
      { pos: [0, 1.85, -3.4], size: [4.2, 0.028, 0.028], colour: 0x1d6ea0, i: 1.5 },
    ];
    for (const a of accents) {
      const m = bar(...a.size, a.colour, a.i);
      m.position.set(...a.pos);
      this.group.add(m);
    }
  }

  /* ─────────────────────────── analytic lights ──────────────────────── */

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x2a3444, 0.55));

    const key = new THREE.SpotLight(0xf2f7ff, 22, 12, Math.PI / 8, 0.5, 1.5);
    key.position.set(-1.25, 2.35, 1.85);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.6;
    key.shadow.camera.far = 8;
    key.shadow.bias = -0.00016;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    this.scene.add(key, key.target);
    this.key = key;

    const fill = new THREE.SpotLight(0xa8c6ff, 6.0, 3.4, Math.PI / 9, 0.9, 1.6);
    fill.position.set(1.9, 0.95, 1.5);
    fill.target.position.set(0, 0, 0);
    this.scene.add(fill, fill.target);

    const rim = new THREE.DirectionalLight(0x6fb6e8, 2.3);
    rim.position.set(0.8, 0.7, -2.4);
    this.scene.add(rim);

    const under = new THREE.PointLight(0x2b4460, 2.2, 4, 2);
    under.position.set(0, -0.35, 0.7);
    this.scene.add(under);

    // Narrow downlight that lays a pool around the stand's feet. Without it
    // the floor goes to pure black and the rig reads as floating in a void.
    const pool = new THREE.SpotLight(0xcfe2ff, 26, 5.5, Math.PI / 9, 0.75, 1.5);
    pool.position.set(0, 2.1, -0.30);
    pool.target.position.set(0, -0.95, -0.42);
    this.scene.add(pool, pool.target);
  }

  /* ─────────────────────────────── the stand ───────────────────────────── */

  /**
   * A bench rig for the wheel. Without it the assembly floats, and a floating
   * subject is the fastest way to make a render stop reading as a photograph.
   */
  _buildStand() {
    const steel = new THREE.MeshPhysicalMaterial({
      color: 0x0f1218, roughness: 0.48, metalness: 0.9, envMapIntensity: 0.8,
    });
    const floorY = -0.95;
    const z = -0.46;
    // Two posts rather than one on the centreline: a single column sits right
    // in the wheel's bottom notch from the driver's eyeline and reads as
    // though it grows through the part. At ±105 mm the posts fall behind the
    // grips instead, and only emerge below the shell.
    const postX = 0.105;

    const add = (mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    const base = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.026, 0.26), steel));
    base.position.set(0, floorY + 0.013, z);

    const height = Math.abs(floorY) - 0.026;
    for (const side of [-1, 1]) {
      const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.036, height, 0.044), steel));
      post.position.set(side * postX, floorY + 0.026 + height / 2, z);

      // Gusset where the post meets the base.
      const gusset = add(new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.075, 0.010), steel));
      gusset.position.set(side * postX, floorY + 0.064, z + 0.030);
    }

    // Cross member carrying the bearing — hidden behind the shell.
    const beam = add(new THREE.Mesh(new THREE.BoxGeometry(postX * 2, 0.046, 0.050), steel));
    beam.position.set(0, 0, z);

    const bearing = add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.086, 28), steel));
    bearing.rotation.x = Math.PI / 2;
    bearing.position.set(0, 0, z);

    this.stand = { base, beam, bearing };
  }

  /* ───────────────────────────── atmosphere ─────────────────────────── */

  _buildDust() {
    const count = 380;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 1.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      seed[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.0040,
      color: 0x9fc4e8,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this._dustBase = pos.slice();
  }

  /* ──────────────────────────── baked IBL ───────────────────────────── */

  /**
   * Renders a stand-in of the rig into a PMREM cube so reflections carry the
   * real shapes and positions of the lights above the wheel.
   */
  _bakeIBL(renderer) {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x05070a);

    const emit = (colour, intensity) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour).multiplyScalar(intensity),
    });

    const panel = (w, h, d, colour, i, pos, rot = [0, 0, 0]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), emit(colour, i));
      m.position.set(...pos);
      m.rotation.set(...rot);
      envScene.add(m);
      return m;
    };

    // Ceiling softboxes — broad, slightly warm.
    panel(1.1, 0.04, 3.2, 0xe8f1ff, 5.0, [-1.0, 2.0, 0.4]);
    panel(1.1, 0.04, 3.2, 0xe8f1ff, 5.0, [1.0, 2.0, 0.4]);
    panel(4.0, 0.04, 0.8, 0xc8dcff, 3.0, [0, 2.2, -1.5]);

    // Front bounce, so the driver-facing surfaces are not pure shadow.
    panel(3.2, 2.0, 0.04, 0x9db6d8, 0.75, [0, 0.5, 3.4]);

    // Cool kickers left and right.
    panel(0.06, 2.2, 2.2, 0x3f9fd6, 2.4, [-3.0, 0.4, -1.2]);
    panel(0.06, 2.2, 2.2, 0x3f9fd6, 2.4, [3.0, 0.4, -1.2]);

    // Dark floor and ceiling close the box off.
    panel(12, 0.04, 12, 0x0a0d12, 1.0, [0, -0.65, 0]);
    panel(12, 0.04, 12, 0x070a0e, 1.0, [0, 3.0, 0]);
    panel(0.04, 12, 12, 0x0b0f15, 1.0, [-5.0, 0, 0]);
    panel(0.04, 12, 12, 0x0b0f15, 1.0, [5.0, 0, 0]);
    panel(12, 12, 0.04, 0x090c11, 1.0, [0, 0, -5.0]);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(envScene, 0.012);
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    return target.texture;
  }

  update(dt, elapsed) {
    const pos = this.dust.geometry.attributes.position;
    const seed = this.dust.geometry.attributes.seed;
    for (let i = 0; i < pos.count; i++) {
      const s = seed.getX(i);
      pos.setX(i, this._dustBase[i * 3] + Math.sin(elapsed * 0.11 + s) * 0.10);
      pos.setY(i, this._dustBase[i * 3 + 1] + Math.sin(elapsed * 0.07 + s * 1.7) * 0.06);
      pos.setZ(i, this._dustBase[i * 3 + 2] + Math.cos(elapsed * 0.09 + s * 0.6) * 0.09);
    }
    pos.needsUpdate = true;
  }
}
