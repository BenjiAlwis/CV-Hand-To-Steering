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
  const carbon = carbonWeave({ size: 1024, cells: 22, seed: 7 });
  const carbonNormal = normalMapFromHeight(carbon.height, 1.9);

  const suede = alcantara({ size: 1024, seed: 19, tint: [24, 25, 29] });
  const suedeNormal = normalMapFromHeight(suede.height, 1.1);

  const rubber = moldedRubber({ size: 512, seed: 57, tint: [20, 21, 24] });
  const rubberNormal = normalMapFromHeight(rubber.height, 1.6);

  const alu = brushedMetal({ size: 512, seed: 31, radial: true, tint: [168, 174, 184] });
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

  const faceplate = new THREE.MeshPhysicalMaterial({
    map: faceplateMaps.map,
    roughnessMap: faceplateMaps.roughnessMap,
    aoMap: faceplateMaps.aoMap,
    normalMap: faceNormal,
    normalScale: new THREE.Vector2(0.34, 0.34),
    roughness: 1.0,
    metalness: 0.04,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.1,
  });
  faceplate.aoMap.channel = 0;
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
    color: 0x4c525d,
    roughness: 1.0,
    metalness: 0.04,
    clearcoat: 0.35,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.8,
  });
  for (const t of [carbonBack.map, carbonBack.roughnessMap, carbonBack.normalMap]) {
    t.repeat.set(shell.width / 0.044, shell.height / 0.044);
    t.anisotropy = 16;
  }

  /** Plain lacquered carbon for paddles, hub shroud and grip cores. */
  const carbonPlain = new THREE.MeshPhysicalMaterial({
    map: colorTexture(carbon.color, 3),
    roughnessMap: dataTexture(carbon.roughness, 3),
    normalMap: dataTexture(carbonNormal, 3),
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 1.0,
    metalness: 0.05,
    clearcoat: 0.9,
    clearcoatRoughness: 0.10,
    envMapIntensity: 1.2,
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
    faceplate, carbonBack, carbonPlain, carbonEdge, grip, thumbPad,
    dialFace, dialFlank, titanium, anodisedBlack, lens, screenGlass,
    ...Object.values(caps),
  ];

  return {
    faceplate, carbonPlain, carbonBack, carbonEdge,
    grip, thumbPad,
    dialFace, dialFlank, titanium, anodisedBlack,
    caps, lens, screenGlass,
    faceplateMaps,
    /** Frees the per-team GPU resources when the wheel is swapped out. */
    dispose() {
      for (const m of all) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
          if (m[key] && m[key].dispose) m[key].dispose();
        }
        m.dispose();
      }
    },
  };
}
