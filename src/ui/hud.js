/**
 * Binds the controller's state to the DOM overlay.
 *
 * Deliberately dumb: it reads, it never writes anything back into the rig.
 */
export class Hud {
  constructor() {
    this.el = {
      root: document.getElementById('hud'),
      angle: document.getElementById('angleValue'),
      norm: document.getElementById('normValue'),
      src: document.getElementById('srcValue'),
      conf: document.getElementById('confValue'),
      fill: document.getElementById('steerFill'),
      needle: document.getElementById('steerNeedle'),
      fps: document.getElementById('fpsValue'),
      draws: document.getElementById('drawValue'),
      cam: document.getElementById('camValue'),
      team: document.getElementById('teamValue'),
      teamSub: document.getElementById('teamSub'),
    };
    this.visible = true;
    this._accum = 0;
    this._frames = 0;
    this._fps = 0;
  }

  /** @param {object} spec the newly mounted team spec */
  setTeam(spec) {
    if (!this.el.team) return;
    this.el.team.textContent = spec.name;
    this.el.teamSub.textContent = spec.subtitle;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.root.classList.toggle('hidden', !this.visible);
  }

  reveal() {
    this.el.root.classList.remove('hidden');
    this.visible = true;
  }

  update(dt, { controller, renderer, cameraName }) {
    this._accum += dt;
    this._frames++;
    if (this._accum >= 0.5) {
      this._fps = Math.round(this._frames / this._accum);
      this._accum = 0;
      this._frames = 0;
      this.el.fps.textContent = String(this._fps);
      this.el.draws.textContent = String(renderer.info.render.calls);
    }
    if (!this.visible) return;

    const deg = controller.degrees;
    const norm = controller.normalised;

    this.el.angle.textContent = deg.toFixed(1);
    this.el.norm.textContent = norm.toFixed(3);
    this.el.src.textContent = controller.activeName;
    this.el.conf.textContent = controller.held ? controller.confidence.toFixed(2) : '—';
    this.el.cam.textContent = cameraName;

    const pct = Math.abs(norm) * 50;
    this.el.fill.style.width = `${pct}%`;
    this.el.fill.style.left = norm >= 0 ? '50%' : `${50 - pct}%`;
    this.el.needle.style.left = `calc(${50 + norm * 50}% - 1px)`;
  }
}
