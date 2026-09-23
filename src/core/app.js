/**
 * Renderer, camera work and the frame loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Framing presets. The default is roughly where a driver's eyes sit. */
export const VIEWS = {
  driver: { name: 'driver', position: [0, 0.030, 0.640], target: [0, 0.004, 0], fov: 32 },
  quarter: { name: 'quarter', position: [0.400, 0.245, 0.500], target: [0, 0.002, 0.012], fov: 34 },
  detail: { name: 'detail', position: [0.128, 0.086, 0.268], target: [0.016, 0.030, 0.020], fov: 30 },
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

    // Bloom runs on the pre-tone-map buffer, where a clearcoat specular under
    // the key light reaches well past 1.0. The threshold sits above that so
    // only the LEDs and the rig strips flare — otherwise the shell's top edge
    // blows out into a soft blob.
    this.bloom = new UnrealBloomPass(size, 0.38, 0.55, 1.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
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
    this.camera.position.lerp(this._desiredPos.clone().add(drift), k);
    this._camTarget.lerp(this._desiredTarget, k);
    this.camera.lookAt(this._camTarget);
    this.controls.target.copy(this._camTarget);
  }

  start(onFrame) {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 1 / 20);
      this.elapsed += dt;
      onFrame(dt, this.elapsed);
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
