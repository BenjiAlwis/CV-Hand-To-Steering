/**
 * Wheelhouse — stage 1.
 *
 * Builds the bay, the wheel and the input stack, then runs the frame loop.
 *
 * Stage 2 slots a camera hand tracker in at the marked seam below; nothing
 * else in this file has to change, because every input reaches the wheel
 * through `SteeringController`.
 */
import * as THREE from 'three';
import { App, VIEWS } from './core/app.js';
import { Environment } from './scene/environment.js';
import { buildSharedTextures, buildMaterials } from './wheel/materials.js';
import { SteeringWheel } from './wheel/steeringwheel.js';
import { buildSpec, TEAM_IDS, DEFAULT_TEAM, LOCK_DEGREES } from './wheel/spec.js';
import { SteeringController } from './input/controller.js';
import { PointerSource } from './input/pointer.js';
import { KeyboardSource } from './input/keyboard.js';
import { HandTracker } from './vision/handtracker.js';
import { HandTrackingSource } from './input/handsource.js';
import { Shifter } from './input/shifter.js';
import { CameraPanel } from './ui/camerapanel.js';
import { CarSim } from './sim/carsim.js';
import { Hud } from './ui/hud.js';

// Running inside the desktop shell rather than a browser tab.
if (new URLSearchParams(location.search).get('shell') === 'desktop') {
  document.documentElement.classList.add('desktop');
}

const boot = document.getElementById('boot');
const bootMsg = boot.querySelector('.boot-msg');
const bootPips = [...boot.querySelectorAll('.pip')];

/**
 * Yields to the browser so the boot screen can actually paint between steps,
 * and lights the mark's rev pips as it goes — the loading bar is the wheel's
 * own light strip.
 *
 * Five steps across eleven pips means a step lights two or three at once. They
 * are staggered rather than switched together, so the bar rolls the way a rev
 * strip does instead of snapping in blocks. The delay is per group, not per
 * pip index: a fixed per-index delay would leave the last pips arriving a
 * quarter of a second late, after the screen had already begun to fade.
 */
const STEPS = 5;
const PIP_STAGGER_MS = 34;
let stepsDone = 0;
const step = async (message) => {
  bootMsg.textContent = message;
  stepsDone += 1;
  const lit = Math.round((stepsDone / STEPS) * bootPips.length);
  let n = 0;
  bootPips.forEach((pip, i) => {
    if (i >= lit || pip.classList.contains('lit')) return;
    pip.style.transitionDelay = `${n++ * PIP_STAGGER_MS}ms`;
    pip.classList.add('lit');
  });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

async function main() {
  const app = new App(document.getElementById('stage'));

  await step('lighting the bay…');
  const environment = new Environment(app.renderer, app.scene);

  await step('weaving carbon…');
  // The procedural source textures are the slow part and do not depend on
  // which team is on the rig, so they are generated once and shared.
  const shared = buildSharedTextures();

  await step('assembling the wheel…');
  const rig = { teamId: null, spec: null, materials: null, wheel: null };

  /** Swaps the wheel on the rig, releasing the one that was there. */
  function mountWheel(teamId) {
    if (rig.teamId === teamId) return rig.spec;

    if (rig.wheel) {
      rig.wheel.dispose();
      rig.materials.dispose();
    }

    const spec = buildSpec(teamId);
    const materials = buildMaterials(shared, spec);
    const wheel = new SteeringWheel(materials, spec);
    wheel.setAngle(controller?.angle ?? 0);
    app.scene.add(wheel.group);

    Object.assign(rig, { teamId, spec, materials, wheel });
    document.documentElement.style.setProperty('--accent', spec.livery.hudAccent);
    hud?.setTeam(spec);
    app.renderer.compile(app.scene, app.camera);
    return spec;
  }

  await step('warming the rig…');
  const controller = new SteeringController({ lockDegrees: LOCK_DEGREES });
  const sim = new CarSim();
  const hud = new Hud();

  mountWheel(DEFAULT_TEAM);

  // The pointer source swings the wheel about its projected centre, so the
  // gesture matches what the camera tracker will read from a pair of hands.
  const pivot = { x: 0, y: 0 };
  const wheelOrigin = new THREE.Vector3(0, 0, 0);
  await controller.addSource(new PointerSource(app.canvas, () => pivot));
  await controller.addSource(new KeyboardSource({ lock: controller.lock }));

  /* ── camera hand tracking ──────────────────────────────────────────── */

  const cameraFeed = document.getElementById('cameraFeed');

  let cameraBusy = false;
  const camera = new CameraPanel({
    onToggle: () => toggleCamera(),
    onRecalibrate: () => handSource.recalibrate(),
    onRatio: (step) => handSource.setRatio(handSource.ratio + step),
  });

  const tracker = new HandTracker({
    onStatus: ({ state, message }) => {
      const tone = state === 'error' ? 'error'
        : state === 'loading' || state === 'opening' ? 'busy'
        : state === 'off' ? 'idle' : 'live';
      camera.setStatus(message, tone);
    },
  });
  const handSource = new HandTrackingSource(tracker, { lock: controller.lock });

  // Highest priority of the three: if you are holding the wheel with your
  // hands, that beats a stale mouse drag or a held key.
  await controller.addSource(handSource);

  /**
   * Gear flaps. A finger pull on either hand shifts, and the paddle on the
   * wheel is pulled to match so the gesture has something to answer it.
   */
  const shift = (direction) => {
    if (sim.shift(direction)) rig.wheel?.pullShiftPaddle(direction);
  };
  const shifter = new Shifter(handSource, { onShift: shift });

  async function toggleCamera(force) {
    if (cameraBusy) return;
    const want = force ?? !tracker.running;
    cameraBusy = true;
    try {
      if (want) {
        await tracker.start(cameraFeed);
        camera.setEnabled(true);
      } else {
        tracker.stop();
        handSource.recalibrate();
        camera.setEnabled(false);
      }
    } catch {
      camera.setEnabled(false);      // the tracker already reported why
    } finally {
      cameraBusy = false;
    }
  }

  app.renderer.shadowMap.needsUpdate = true;

  const cycleTeam = (dir) => {
    const i = TEAM_IDS.indexOf(rig.teamId);
    mountWheel(TEAM_IDS[(i + dir + TEAM_IDS.length) % TEAM_IDS.length]);
  };

  bindKeys(app, controller, hud, cycleTeam, { toggleCamera, handSource, shift });

  app.start((dt, elapsed) => {
    app.updateCamera(dt);
    app.project(wheelOrigin, pivot);

    const angle = controller.update(dt);
    rig.wheel.setAngle(angle);
    // After the steering source has read, so the named hands are current.
    shifter.update();

    const telemetry = sim.update(dt, controller.normalised);
    rig.wheel.update(dt, telemetry);
    environment.update(dt, elapsed);
    camera.draw(cameraFeed, tracker, handSource, shifter);

    hud.update(dt, {
      controller,
      renderer: app.renderer,
      cameraName: app.freeCamera ? 'free' : app.view.name,
    });
  });

  await step('ready');
  clearTimeout(window.__wheelhouseWatchdog);
  // A beat for the last pips to finish arriving. Fading over the top of them
  // mid-transition reads as the screen being cut off rather than completing,
  // and the scene behind is already drawn by this point.
  await new Promise((r) => setTimeout(r, 260));
  boot.classList.add('done');
  hud.reveal();
  setTimeout(() => boot.remove(), 700);

  // The camera is what the rig is for, so it comes up on its own.
  //
  // In a browser we start it ourselves, a moment after the scene is on screen
  // so a slow device open never delays the first frames. In the desktop shell
  // the main process starts it instead, once macOS has actually granted
  // access — asking from here first would fail with no dialog shown.
  camera.setStatus('starting camera…', 'busy');
  if (!document.documentElement.classList.contains('desktop')) {
    setTimeout(() => toggleCamera(true), 350);
  }

  // Handy from the console while iterating.
  Object.assign(window, { app, rig, controller, sim, environment, tracker, handSource, shifter });
  Object.defineProperty(window, 'wheel', { get: () => rig.wheel, configurable: true });

  // The surface the desktop shell's menu drives. Kept separate from the
  // internals above so the menu does not break when they are refactored.
  window.wheelhouse = {
    view(name) {
      if (app.freeCamera) app.toggleFreeCamera();
      if (VIEWS[name]) app.setView(VIEWS[name]);
    },
    freeCamera: () => app.toggleFreeCamera(),
    recentre: () => controller.recentre(),
    toggleHud: () => hud.toggle(),
    setTeam: (id) => mountWheel(id),
    camera: (on) => toggleCamera(on),
    cameraOn: () => tracker.running,
    recalibrate: () => handSource.recalibrate(),
    shift: (d) => shift(d),
    ratio: (v) => handSource.setRatio(v),
    teams: () => TEAM_IDS.map((id) => ({ id, name: buildSpec(id).name })),
    currentTeam: () => rig.teamId,
  };
}

function bindKeys(app, controller, hud, cycleTeam, vision) {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return;
    switch (event.code) {
      case 'KeyC': app.toggleFreeCamera(); break;
      case 'KeyR': controller.recentre(); break;
      case 'KeyH': hud.toggle(); break;
      case 'KeyT': cycleTeam(event.shiftKey ? -1 : 1); break;
      case 'KeyV': vision.toggleCamera(); break;
      case 'KeyZ': vision.handSource.recalibrate(); break;
      case 'KeyE': vision.shift(1); break;
      case 'KeyQ': vision.shift(-1); break;
      case 'Minus': vision.handSource.setRatio(vision.handSource.ratio - 0.25); break;
      case 'Equal': vision.handSource.setRatio(vision.handSource.ratio + 0.25); break;
      case 'BracketLeft': cycleTeam(-1); break;
      case 'BracketRight': cycleTeam(1); break;
      case 'Digit1': app.setView(VIEWS.driver); if (app.freeCamera) app.toggleFreeCamera(); break;
      case 'Digit2': app.setView(VIEWS.quarter); if (app.freeCamera) app.toggleFreeCamera(); break;
      case 'Digit3': app.setView(VIEWS.detail); if (app.freeCamera) app.toggleFreeCamera(); break;
      default: return;
    }
  });

  // Whenever the wheel settles somewhere new, let the sources pick up from
  // there instead of fighting the spring.
  window.addEventListener('pointerup', () => controller.syncSources());
}

main().catch((error) => {
  console.error(error);
  boot.classList.add('failed');
  bootMsg.textContent = `failed: ${error.message}`;
});
