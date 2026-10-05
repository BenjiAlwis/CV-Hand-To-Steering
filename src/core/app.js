/**
 * Renderer, camera work and the frame loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Graphics quality, from what any machine can run to everything on. The hand
 * and foot trackers share the GPU with the scene, so the costly effects are
 * the ones a slower machine turns off first.
 *
 *   low     baked lighting, small shadow map, no post effects
 *   medium  studio lighting and softboxes, a gentle vignette
 *   high    + ambient occlusion, a sharp shadow map, fine film grain
 *   ultra   + depth of field in the detail view, full pixel density
 */
export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

/**
 * A lens's last touches: corners falling off a little and a fine, moving
 * grain. Applied after tone mapping, as a camera would — kept faint, because
 * past a certain point both read as an effect rather than a photograph.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.22 },
    grain: { value: 0.0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.0);
      c.rgb += (hash(vUv * 1024.0) - 0.5) * grain;
      gl_FragColor = c;
    }
  `,
};

/** Framing presets. The default is roughly where a driver's eyes sit. */
export const VIEWS = {
  driver: { name: 'driver', position: [0, 0.030, 0.640], target: [0, 0.004, 0], fov: 32 },
  quarter: { name: 'quarter', position: [0.400, 0.245, 0.500], target: [0, 0.002, 0.012], fov: 34 },
  detail: { name: 'detail', position: [0.128, 0.086, 0.268], target: [0.016, 0.030, 0.020], fov: 30 },
  // Behind the wheel: a three-quarter from the other side and above, the
  // mirror of `quarter`, showing the paddles, the back of the shell and the
  // quick-release; and a low angle from the opposite side looking up under
  // the paddles at the hub.
  rearQuarter: { name: 'rearQuarter', label: 'rear ¾', position: [-0.300, 0.170, -0.380], target: [0.010, 0.004, -0.030], fov: 34 },
  rearLow: { name: 'rearLow', label: 'rear low', position: [0.350, -0.050, -0.330], target: [-0.008, 0.012, -0.034], fov: 34 },
};

export class App {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.02, 60);
    this.view = VIEWS.driver;
    this.camera.position.fromArray(this.view.position);
    this._camTarget = new THREE.Vector3().fromArray(this.view.target);
    this._desiredPos = this.camera.position.clone();
    this._desiredTarget = this._camTarget.clone();
    this.camera.lookAt(this._camTarget);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 0.16;
    this.controls.maxDistance = 3.2;
    this.controls.target.copy(this._camTarget);
    this.controls.enabled = false;
    this.freeCamera = false;

    this.quality = 'high';
    this._buildComposer();

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  _buildComposer() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);

    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: Math.min(4, this.renderer.capabilities.maxSamples ?? 4),
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ambient occlusion: the soft contact shadow where a button meets its
    // pocket or a rotary its skirt. Without it small parts look laid on top.
    // Its radius is in metres, sized to switchgear rather than to a room.
    const q = QUALITY_LEVELS.indexOf(this.quality);
    if (q >= 2) {
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.ao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.4, thickness: 0.01, scale: 1.0, samples: 12 });
      this.ao.blendIntensity = 0.85;
      this.composer.addPass(this.ao);
    } else {
      this.ao = null;
    }

    // Bloom runs on the pre-tone-map buffer, where a clearcoat specular under
    // the key light reaches well past 1.0. The threshold sits above that so
    // only the LEDs and the rig strips flare — otherwise the shell's top edge
    // blows out into a soft blob.
    this.bloom = new UnrealBloomPass(size, 0.38, 0.55, 1.35);
    this.composer.addPass(this.bloom);

    // Depth of field, only in the close detail view and only on Ultra:
    // focused on the wheel, the bay behind falls away as a macro lens would.
    if (q >= 3) {
      this.dof = new BokehPass(this.scene, this.camera, { focus: 0.3, aperture: 0.004, maxblur: 0.006 });
      this.dof.enabled = this.view?.name === 'detail';
      this.composer.addPass(this.dof);
    } else {
      this.dof = null;
    }

    this.composer.addPass(new OutputPass());

    if (q >= 1) {
      this.lens = new ShaderPass(LensShader);
      this.lens.uniforms.vignette.value = 0.22;
      this.lens.uniforms.grain.value = q >= 2 ? 0.018 : 0;
      this.composer.addPass(this.lens);
    } else {
      this.lens = null;
    }
  }

  /** Switches graphics quality, live. */
  setQuality(level) {
    if (!QUALITY_LEVELS.includes(level) || level === this.quality) return;
    this.quality = level;
    // Full pixel density only at the top; a high-DPI screen at 2× is four
    // times the pixels to shade.
    const ratio = level === 'ultra' ? Math.min(window.devicePixelRatio, 2)
      : level === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(ratio);
    this.composer?.dispose?.();
    this._buildComposer();
    this._onResize();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.bloom.setSize(size.x, size.y);
  }

  setView(view) {
    this.view = view;
    if (this.dof) this.dof.enabled = view.name === 'detail';
    this._desiredPos.fromArray(view.position);
    this._desiredTarget.fromArray(view.target);
    if (this.camera.fov !== view.fov) {
      this.camera.fov = view.fov;
      this.camera.updateProjectionMatrix();
    }
    this.controls.target.copy(this._desiredTarget);
  }

  toggleFreeCamera() {
    this.freeCamera = !this.freeCamera;
    this.controls.enabled = this.freeCamera;
    this.canvas.classList.toggle('orbit', this.freeCamera);
    if (this.freeCamera) {
      this.controls.target.copy(this._camTarget);
      this.controls.update();
    }
    return this.freeCamera;
  }

  /** Projects a world point to CSS pixel coordinates. */
  project(worldPoint, out = { x: 0, y: 0 }) {
    const v = worldPoint.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }

  updateCamera(dt) {
    if (this.freeCamera) {
      this.controls.update();
      this._camTarget.copy(this.controls.target);
      return;
    }
    // Ease toward the preset, with a slow handheld drift so static shots do
    // not look like a locked-off render.
    const k = 1 - Math.pow(0.0009, dt);
    const drift = new THREE.Vector3(
      Math.sin(this.elapsed * 0.21) * 0.0070,
      Math.sin(this.elapsed * 0.17 + 1.1) * 0.0045,
      Math.sin(this.elapsed * 0.13 + 2.3) * 0.0035,
    );
    // Swing round the target rather than cutting straight across: going
    // from the front to a view behind the wheel, a straight line would pass
    // through it. Direction turns by the same fraction the distance closes.
    this._camTarget.lerp(this._desiredTarget, k);
    const want = this._desiredPos.clone().add(drift).sub(this._desiredTarget);
    const have = this.camera.position.clone().sub(this._camTarget);
    const r = THREE.MathUtils.lerp(have.length(), want.length(), k);
    const turn = new THREE.Quaternion().setFromUnitVectors(have.clone().normalize(), want.clone().normalize());
    const dir = have.normalize().applyQuaternion(new THREE.Quaternion().slerp(turn, k));
    this.camera.position.copy(this._camTarget).addScaledVector(dir, r);
    this.camera.lookAt(this._camTarget);
    this.controls.target.copy(this._camTarget);
  }

  start(onFrame) {
    const loop = () => {
      // Animation steps are capped so a stall never throws anything across
      // the screen; the true time is passed on too, for whatever has to keep
      // up with the clock — the car, which must not run slow on a slow frame.
      const real = this.clock.getDelta();
      const dt = Math.min(real, 1 / 20);
      this.elapsed += dt;
      onFrame(dt, this.elapsed, Math.min(real, 0.25));
      if (this.lens) this.lens.uniforms.time.value = this.elapsed % 100;
      if (this.dof?.enabled) this.dof.uniforms.focus.value = this.camera.position.distanceTo(this._camTarget);
      this.composer.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }
}
