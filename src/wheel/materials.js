/**
 * The wheel's material library.
 *
 * Everything is physically based and driven by the procedural texture lab.
 * Values are chosen to match how these surfaces actually behave: lacquered
 * carbon gets a clearcoat over a satin base, suede gets sheen and almost no
 * specular, anodised aluminium gets tinted metal reflectance.
 *
 * Split in two on purpose. The procedural source textures are expensive and
 * team-independent, so they are generated once and shared; only the painted
 * faceplate and the livery tints are rebuilt when the wheel is swapped.
 */
import * as THREE from 'three';
import {
  carbonWeave, alcantara, brushedMetal, knurlHeight, moldedRubber,
  normalMapFromHeight, colorTexture, dataTexture,
} from '../textures/procedural.js';
import { buildFaceplateTextures } from './faceplate.js';
import { CAP_COLOURS } from './caps.js';

/** Generated once per session — the slow part. */
export function buildSharedTextures() {
  // 1024 px over a 44 mm tile is about 23 px per millimetre — far more than
  // the wheel ever fills on screen. 2048 cost three seconds of every launch
  // for no visible gain.
  const carbon = carbonWeave({ size: 1024, cells: 22, seed: 7 });
  const carbonNormal = normalMapFromHeight(carbon.height, 1.9);

  const suede = alcantara({ size: 1024, seed: 19, tint: [24, 25, 29] });
  const suedeNormal = normalMapFromHeight(suede.height, 1.1);

  const rubber = moldedRubber({ size: 1024, seed: 57, tint: [20, 21, 24] });
  const rubberNormal = normalMapFromHeight(rubber.height, 1.6);

  const alu = brushedMetal({ size: 1024, seed: 31, radial: true, tint: [168, 174, 184] });
  const aluNormal = normalMapFromHeight(alu.height, 1.2);

  const knurl = normalMapFromHeight(knurlHeight({ size: 512, teeth: 80 }), 2.6);

  return { carbon, carbonNormal, suede, suedeNormal, rubber, rubberNormal, alu, aluNormal, knurl };
}

/**
 * @param {ReturnType<typeof buildSharedTextures>} shared
 * @param {object} spec the resolved team spec
 */
export function buildMaterials(shared, spec) {
  const { carbon, carbonNormal, suede, suedeNormal, rubber, rubberNormal, alu, aluNormal, knurl } = shared;
  const { shell, livery } = spec;

  /* ── carbon fibre ──────────────────────────────────────────────── */
  const faceplateMaps = buildFaceplateTextures(carbon, spec);
  const faceNormal = dataTexture(carbonNormal, 1);
  faceNormal.repeat.set(shell.width / 0.044, shell.height / 0.044);

  // Fibre direction, tiled exactly as the weave is, so each tow streaks its
  // highlight along itself.
  const faceDirection = dataTexture(carbon.direction, 1);
  faceDirection.repeat.copy(faceNormal.repeat);

  const faceplate = new THREE.MeshPhysicalMaterial({
    map: faceplateMaps.map,
    roughnessMap: faceplateMaps.roughnessMap,
    aoMap: faceplateMaps.aoMap,
    normalMap: faceNormal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 1.0,
    metalness: 0.04,
    anisotropy: 0.75,
    anisotropyMap: faceDirection,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
  });
  faceplate.aoMap.channel = 0;
  // A painted face hides the weave's relief: only a trace of it shows
  // through the paint, and the fibres no longer streak the highlight.
  if (livery.paint) {
    faceplate.normalScale.set(0.06, 0.06);
    faceplate.anisotropy = 0.1;
  }
  // Where the face is painted, the lacquer drops away (clearcoat × map).
  if (faceplateMaps.clearcoatMap) faceplate.clearcoatMap = faceplateMaps.clearcoatMap;
  faceplate.aoMapIntensity = 0.85;

  /**
   * Back of the shell. Shares the weave with the face but tiled to the
   * shell's own UV space, and much darker: the back is laid up and left in
   * satin rather than polished, which also keeps the weave from aliasing
   * into a moiré at the steep angles the back is usually seen from.
   */
  const carbonBack = new THREE.MeshPhysicalMaterial({
    map: colorTexture(carbon.color, 1),
    roughnessMap: dataTexture(carbon.roughness, 1),
    normalMap: dataTexture(carbonNormal, 1),
    normalScale: new THREE.Vector2(0.18, 0.18),
    anisotropy: 0.6,
    anisotropyMap: dataTexture(carbon.direction, 1),
    color: 0xb4b8bf,
    roughness: 1.0,
    metalness: 0.04,
    clearcoat: 0.35,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.8,
  });
  for (const t of [carbonBack.map, carbonBack.roughnessMap, carbonBack.normalMap, carbonBack.anisotropyMap]) {
    t.repeat.set(shell.width / 0.044, shell.height / 0.044);
    t.anisotropy = 16;
  }

  /** Plain lacquered carbon for paddles, hub shroud and grip cores. */
  const carbonPlain = new THREE.MeshPhysicalMaterial({
    map: colorTexture(carbon.color, 3),
    roughnessMap: dataTexture(carbon.roughness, 3),
    normalMap: dataTexture(carbonNormal, 3),
    normalScale: new THREE.Vector2(0.45, 0.45),
    anisotropy: 0.75,
    anisotropyMap: dataTexture(carbon.direction, 3),
    roughness: 1.0,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.2,
  });

  /** A display module's black glass: deep, glossy, a little reflective. */
  const moduleGlass = new THREE.MeshPhysicalMaterial({
    color: 0x05070a, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.2,
  });

  /** Machined edge of the laminate — matte black resin, no weave visible. */
  const carbonEdge = new THREE.MeshPhysicalMaterial({
    color: 0x0a0c10,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });

  /* ── grip surfaces ─────────────────────────────────────────────── */
  /**
   * Moulded grip. Teams inject silicone into the void between the carbon
   * shell and a mould taken from the driver's hands, and the result is matte
   * and nearly black. Strong sheen and environment response — the settings
   * that suit an Alcantara rim — turn it a pale glassy blue instead.
   */
  /**
   * Smooth moulded silicone — Mercedes' grips. Satin rather than suede: dark,
   * but with a broad soft highlight along the curve, which is what shows
   * the handle's shape against a dark background.
   */
  const silicone = new THREE.MeshPhysicalMaterial({
    color: 0x1c1d20,
    roughness: 0.5,
    metalness: 0.0,
    specularIntensity: 0.5,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0x3a3e46),
    clearcoat: 0.15,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.1,
  });

  /**
   * Red Bull's grips: a mid-grey moulding, fine-textured and matte, with a
   * black rubber sleeve over the lower half where the fingers wrap.
   */
  const greySilicone = new THREE.MeshPhysicalMaterial({
    normalMap: dataTexture(suedeNormal, 2),
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0x4a4e55,
    roughness: 0.8,
    metalness: 0.0,
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0x5a5f68),
    specularIntensity: 0.35,
    envMapIntensity: 0.9,
  });
  greySilicone.normalMap.repeat.set(3, 2);

  const sleeve = new THREE.MeshPhysicalMaterial({
    map: colorTexture(rubber.color, 2),
    normalMap: dataTexture(rubberNormal, 2),
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0x6a6e75,
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.0,
  });

  /** Satin grey housings on the face — Red Bull's roller pods. */
  const podSatin = new THREE.MeshPhysicalMaterial({
    color: 0x2c2f35, roughness: 0.55, metalness: 0.0,
    clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: 1.0,
  });

  /** Satin black display housing: moulded, not glass. */
  const housingSatin = new THREE.MeshPhysicalMaterial({
    color: 0x111215, roughness: 0.5, metalness: 0.0,
    clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 1.0,
  });

  /** Glossy black bezels round Red Bull's buttons and rotaries. */
  const bezelBlack = new THREE.MeshPhysicalMaterial({
    color: 0x0b0c0f, roughness: 0.22, metalness: 0.2,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.3, side: THREE.DoubleSide,
  });

  /** A rotary knob's knurled black flank, and its smooth crown. */
  const knurlBlack = new THREE.MeshPhysicalMaterial({
    color: 0x121418,
    normalMap: dataTexture(knurl, 1),
    normalScale: new THREE.Vector2(1.6, 1.6),
    roughness: 0.45, metalness: 0.6, envMapIntensity: 1.1,
  });
  const knobBlack = new THREE.MeshPhysicalMaterial({
    color: 0x16181c, roughness: 0.35, metalness: 0.5, clearcoat: 0.3, envMapIntensity: 1.1,
  });

  /** Printed white marks standing on a part (a roller's pointer). */
  const inkWhite = new THREE.MeshPhysicalMaterial({ color: 0xe8ebef, roughness: 0.45 });

  const grip = new THREE.MeshPhysicalMaterial({
    map: colorTexture(suede.color, 2),
    normalMap: dataTexture(suedeNormal, 2),
    normalScale: new THREE.Vector2(1.05, 1.05),
    color: 0xa8aeb8,
    roughness: 0.95,
    metalness: 0.0,
    // Enough sheen and ambient pickup for the moulded form to read. Pushed
    // any darker and the grip turns into a black silhouette that tells you
    // nothing about its shape; any glossier and it stops looking like
    // silicone.
    sheen: 0.45,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(0x3b444f),
    specularIntensity: 0.14,
    envMapIntensity: 0.62,
  });
  grip.map.repeat.set(3, 2);
  grip.normalMap.repeat.set(3, 2);

  const thumbPad = new THREE.MeshPhysicalMaterial({
    map: colorTexture(rubber.color, 2),
    normalMap: dataTexture(rubberNormal, 2),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.78,
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.65,
    envMapIntensity: 0.7,
  });

  /* ── metals ────────────────────────────────────────────────────── */
  const dialFace = new THREE.MeshPhysicalMaterial({
    map: colorTexture(alu.color, 1),
    normalMap: dataTexture(aluNormal, 1),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.44,
    metalness: 0.88,
    envMapIntensity: 1.9,
  });

  const dialFlank = new THREE.MeshPhysicalMaterial({
    color: 0x2b2f36,
    normalMap: dataTexture(knurl, 1),
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughness: 0.42,
    metalness: 0.95,
    envMapIntensity: 1.1,
  });

  const titanium = new THREE.MeshPhysicalMaterial({
    color: 0x6e7076, roughness: 0.38, metalness: 1.0, envMapIntensity: 1.3,
  });

  const anodisedBlack = new THREE.MeshPhysicalMaterial({
    color: 0x1a1d22, roughness: 0.45, metalness: 0.85, envMapIntensity: 1.0,
  });

  /* ── switch caps ───────────────────────────────────────────────── */
  const caps = {};
  for (const [name, def] of Object.entries(CAP_COLOURS)) {
    caps[name] = new THREE.MeshPhysicalMaterial({
      color: def.base,
      roughness: 0.42,
      metalness: 0.15,
      clearcoat: 0.35,
      clearcoatRoughness: 0.28,
      envMapIntensity: 1.25,
    });
  }

  /* ── optics ────────────────────────────────────────────────────── */
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x0a0e15,
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    opacity: 0.42,
    transparent: true,
    envMapIntensity: 1.6,
  });

  const screenGlass = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.22,
    metalness: 0.0,
    transparent: true,
    opacity: 0.14,
    clearcoat: 0.55,
    clearcoatRoughness: 0.24,
    envMapIntensity: 1.0,
  });

  const all = [
    faceplate, carbonBack, carbonPlain, carbonEdge, grip, silicone, thumbPad, moduleGlass,
    greySilicone, sleeve, podSatin, housingSatin, bezelBlack, knurlBlack, knobBlack, inkWhite,
    dialFace, dialFlank, titanium, anodisedBlack, lens, screenGlass,
    ...Object.values(caps),
  ];

  return {
    faceplate, carbonPlain, carbonBack, carbonEdge,
    grip, silicone, thumbPad,
    greySilicone, sleeve, podSatin, housingSatin, bezelBlack, knurlBlack, knobBlack, inkWhite,
    dialFace, dialFlank, titanium, anodisedBlack,
    caps, lens, screenGlass, moduleGlass,
    faceplateMaps,
    /** Frees the per-team GPU resources when the wheel is swapped out. */
    dispose() {
      for (const m of all) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'clearcoatMap']) {
          if (m[key] && m[key].dispose) m[key].dispose();
        }
        m.dispose();
      }
    },
  };
}
