/**
 * Roll-up controls on every panel.
 *
 * The important part is what collapsing does *not* do. A rolled-up camera
 * panel is still tracking — the model keeps running, the wheel keeps being
 * steered, the pedals keep working — because wanting the picture out of the
 * way is not the same as wanting the camera off. There is already a button
 * for turning the camera off, and it says so.
 *
 * What collapsing does save is the drawing: a preview nobody can see does not
 * need the frame blitted into it every frame, and `CameraPanel` asks this
 * module whether it is worth the work.
 */
const TITLES = {
  steering: 'STEERING',
  rig: 'RIG',
  wheel: 'WHEEL',
  controls: 'CONTROLS',
  camera: 'HAND TRACKING',
  foot: 'PEDALS',
};

export class PanelChrome {
  /**
   * @param {import('./settings.js').Settings} settings
   */
  constructor(settings) {
    this.settings = settings;
    /** @type {Map<string, HTMLElement>} */
    this.panels = new Map();

    for (const el of document.querySelectorAll('#hud .panel[data-panel]')) {
      const id = el.dataset.panel;
      this.panels.set(id, el);

      const title = el.querySelector('.panel-title');
      if (title && !title.querySelector('.panel-roll')) {
        const button = document.createElement('button');
        button.className = 'panel-roll';
        button.type = 'button';
        button.addEventListener('click', () => this.toggle(id));
        title.append(button);
      }
      this._apply(id);
    }

    settings.onChange((key) => {
      if (key === 'collapsed' || key === 'hidden') {
        for (const id of this.panels.keys()) this._apply(id);
      }
    });
  }

  get ids() { return [...this.panels.keys()]; }
  label(id) { return TITLES[id] ?? id; }

  toggle(id) {
    this.settings.setPanel('collapsed', id, !this.settings.isPanel('collapsed', id));
  }

  /** Whether a panel is worth drawing into: on screen and not rolled up. */
  isVisible(id) {
    return !this.settings.isPanel('hidden', id) && !this.settings.isPanel('collapsed', id);
  }

  _apply(id) {
    const el = this.panels.get(id);
    if (!el) return;
    const collapsed = this.settings.isPanel('collapsed', id);
    const hidden = this.settings.isPanel('hidden', id);
    el.classList.toggle('collapsed', collapsed);
    el.classList.toggle('panel-hidden', hidden);
    const button = el.querySelector('.panel-roll');
    if (button) {
      button.textContent = collapsed ? '+' : '−';
      button.title = collapsed ? `expand ${this.label(id)}` : `roll up ${this.label(id)}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', String(!collapsed));
    }
  }
}
