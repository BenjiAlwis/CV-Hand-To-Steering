/**
 * The rev-light bar along the top edge.
 *
 * Fifteen shift LEDs running green → red → blue, with two marshalling flag
 * LEDs at each end. Everything sits under one smoked lens, which is what
 * gives the bar its dark, inert look until the engine picks up.
 *
 * The LEDs are unlit `MeshBasicMaterial` so they blow past 1.0 and get caught
 * by the bloom pass — the same trick that makes real emitters read as hot.
 */
import * as THREE from 'three';
import { plateGeometry } from './geometry.js';


const HUE = {
  green: new THREE.Color(0x22ff6b),
  red:   new THREE.Color(0xff2a18),
  blue:  new THREE.Color(0x3d5cff),
  white: new THREE.Color(0xffffff),
  yellow:new THREE.Color(0xffc21a),
};

/** An unlit die is not black — it is a dull grey lens you can still pick out. */
const DARK = new THREE.Color(0x272e39);

export class RevLights {
  constructor(materials, spec) {
    const { lightBar: LIGHT_BAR, leds: LEDS, shell } = spec;
    this.group = new THREE.Group();
    this.leds = [];

    const z = shell.frontZ;

    // LED dies, recessed just behind the lens.
    // Sized off the bar so a smaller team wheel gets proportionally
    // smaller dies rather than a crowded strip.
    const pitch = LIGHT_BAR.width / 32;
    const dieGeo = plateGeometry(pitch * 0.82, LIGHT_BAR.height * 0.50, pitch * 0.16, 0.0008);
    this._disposables = [dieGeo];

    for (const def of LEDS) {
      const base = def.kind === 'rev' ? HUE[def.colour] : HUE.yellow;
      const material = new THREE.MeshBasicMaterial({ color: DARK.clone(), toneMapped: false });
      const mesh = new THREE.Mesh(dieGeo, material);
      mesh.position.set(def.x, LIGHT_BAR.y, z + 0.0009);
      this.group.add(mesh);
      this.leds.push({ def, material, base: base.clone(), mesh });
    }

    // Smoked lens over the whole bar.
    const lensGeo = plateGeometry(LIGHT_BAR.width, LIGHT_BAR.height, LIGHT_BAR.radius, 0.0022);
    this._disposables.push(lensGeo);
    const lens = new THREE.Mesh(lensGeo, materials.lens);
    lens.position.set(0, LIGHT_BAR.y, z + 0.0024);
    lens.renderOrder = 2;
    this.group.add(lens);

    // A single light bleeds the bar's colour onto the shell below it.
    this.bleed = new THREE.PointLight(0xffffff, 0, 0.16, 2);
    this.bleed.position.set(0, LIGHT_BAR.y - 0.004, z + 0.012);
    this.group.add(this.bleed);

    this._t = 0;
  }

  /**
   * @param {number} dt
   * @param {number} rpmFraction 0..1 of the rev range
   * @param {'none'|'yellow'|'blue'|'red'} flag
   */
  update(dt, rpmFraction, flag = 'none') {
    this._t += dt;
    const shiftNow = rpmFraction > 0.965;
    const strobe = shiftNow && Math.sin(this._t * 48) > 0;
    let hot = 0;

    for (const led of this.leds) {
      const { def, material, base } = led;

      if (def.kind === 'rev') {
        if (strobe) {
          material.color.copy(HUE.blue).multiplyScalar(3.6);
          hot += 1;
        } else if (rpmFraction >= def.threshold) {
          material.color.copy(base).multiplyScalar(2.9);
          hot += 1;
        } else {
          material.color.copy(DARK);
        }
      } else {
        if (flag === 'none') {
          material.color.copy(DARK);
        } else {
          const pulse = 0.55 + 0.45 * Math.sin(this._t * 12);
          const hue = flag === 'yellow' ? HUE.yellow : flag === 'blue' ? HUE.blue : HUE.red;
          material.color.copy(hue).multiplyScalar(2.6 * pulse);
          hot += pulse * 0.5;
        }
      }
    }

    const ratio = hot / Math.max(1, this.leds.length);
    this.bleed.intensity = ratio * 0.09;
    this.bleed.color.setHSL(
      strobe ? 0.65 : THREE.MathUtils.lerp(0.33, 0.0, Math.min(1, rpmFraction / 0.7)),
      0.9, 0.55,
    );
  }
}
