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
import { FootTracker } from './vision/foottracker.js';
import { PedalSource } from './input/pedalsource.js';
import { listCameras, loadAssignment, saveAssignment, resolveAssignment } from './vision/devices.js';
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
    onAssign: (job, deviceId) => assignCamera(job, deviceId),
    onZeroPedals: () => pedals.recalibrate(),
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

  /* ── camera foot tracking ──────────────────────────────────────────── */

  const footFeed = document.getElementById('footFeed');
  const footTracker = new FootTracker({
    onStatus: ({ state, message }) => camera.setFootStatus(message, state),
  });
  const pedals = new PedalSource({ tracker: footTracker });

  /** Seconds without a foot before the car goes back to driving itself. */
  const FEET_HANDBACK = 4;
  let feetLastSeen = null;

  /**
   * Gear flaps. A finger pull on either hand shifts, and the paddle on the
   * wheel is pulled to match so the gesture has something to answer it.
   */
  const shift = (direction) => {
    if (sim.shift(direction)) rig.wheel?.pullShiftPaddle(direction);
  };
  const shifter = new Shifter(handSource, { onShift: shift });

  /**
   * Works out which camera does which job.
   *
   * Device ids are only readable once camera permission is held, so this has
   * to run after a stream has been opened at least once — before that every
   * camera looks the same and looks nameless.
   */
  let assignment = { hands: null, feet: null };
  async function refreshCameras() {
    const { cameras, named } = await listCameras();
    assignment = named
      ? resolveAssignment(cameras, loadAssignment())
      : { hands: null, feet: null };
    camera.setDevices(cameras, assignment, named);
    return { cameras, named };
  }

  /**
   * Brings the foot camera up behind the hand camera.
   *
   * Deliberately not awaited by the caller. A phone acting as the foot camera
   * takes about three seconds to wake — measured at 3.1s against 0.4s for a
   * built-in lens — and there is no reason for steering to wait on pedals.
   */
  async function startFeet() {
    if (!assignment.feet || footTracker.running) return;
    try {
      await footTracker.start(footFeed, assignment.feet);
      pedals.recalibrate();
    } catch {
      /* the panel already carries the reason; steering is unaffected */
    }
  }

  async function toggleCamera(force) {
    if (cameraBusy) return;
    const want = force ?? !tracker.running;
    cameraBusy = true;
    try {
      if (want) {
        await tracker.start(cameraFeed, assignment.hands ?? undefined);
        camera.setEnabled(true);
        // Now that permission is held the device list is readable, so a
        // second camera can finally be told apart from the first.
        await refreshCameras();
        startFeet();
      } else {
        tracker.stop();
        footTracker.stop();
        handSource.recalibrate();
        camera.setEnabled(false);
      }
    } catch {
      camera.setEnabled(false);      // the tracker already reported why
    } finally {
      cameraBusy = false;
    }
  }

  /** Moves a job to a different camera and restarts just that tracker. */
  async function assignCamera(job, deviceId) {
    assignment = { ...assignment, [job]: deviceId };
    // The same lens cannot serve both jobs, so the other one steps aside.
    const other = job === 'hands' ? 'feet' : 'hands';
    if (assignment[other] === deviceId) assignment[other] = null;
    saveAssignment(assignment);

    if (job === 'feet') {
      footTracker.stop();
      await startFeet();
    } else if (tracker.running) {
      tracker.stop();
      await tracker.start(cameraFeed, assignment.hands ?? undefined);
      handSource.recalibrate();
    }
    await refreshCameras();
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

    // Feet drive the car, but only once they have actually been seen.
    //
    // Handing the car over the moment the foot camera opens would park it:
    // with no feet in frame the throttle reads zero, so the car would roll to
    // a stop and sit there looking broken. It waits for a real reading, and
    // hands back after a few seconds without one — long enough that crossing
    // your legs or a foot passing out of frame does not bounce the car
    // between being driven and driving itself.
    let pedalInput = null;
    if (footTracker.running) {
      const read = pedals.read(dt);
      if (pedals.state.tracking) feetLastSeen = elapsed;
      if (feetLastSeen !== null && elapsed - feetLastSeen < FEET_HANDBACK) pedalInput = read;
    } else {
      feetLastSeen = null;
    }
    const telemetry = sim.update(dt, controller.normalised, pedalInput);
    rig.wheel.update(dt, telemetry);
    environment.update(dt, elapsed);
    camera.draw(cameraFeed, tracker, handSource, shifter);
    camera.drawFeet(footFeed, footTracker, pedals);

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
  Object.assign(window, {
    app, rig, controller, sim, environment, tracker, handSource, shifter,
    footTracker, pedals, assignCamera, refreshCameras,
  });
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
