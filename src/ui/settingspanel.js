/**
 * The settings panel.
 *
 * Three things live here: what the camera is allowed to drive, which lens does
 * which job, and which panels are on screen.
 *
 * The camera section is the fiddly one, because a second camera is the only
 * setting whose options the app cannot know in advance — they depend on what
 * is plugged in, or in range, right now. So it can be rescanned, it says when
 * a choice is not available and why, and it explains how to make a phone
 * appear rather than leaving an empty list to be puzzled over.
 */
export class SettingsPanel {
  /**
   * @param {object} o
   * @param {import('./settings.js').Settings} o.settings
   * @param {import('./panelchrome.js').PanelChrome} o.chrome
   * @param {() => Promise<{cameras: Array, named: boolean}>} o.onRescan
   * @param {(job: string, deviceId: string|null) => Promise<void>} o.onAssign
   */
  constructor({ settings, chrome, onRescan, onAssign }) {
    this.settings = settings;
    this.chrome = chrome;
    this.onRescan = onRescan;
    this.onAssign = onAssign;

    this.root = document.getElementById('settings');
    this.el = {
      flaps: document.getElementById('setFlaps'),
      pedals: document.getElementById('setPedals'),
      boxes: document.getElementById('setBoxes'),
      gloves: document.getElementById('setGloves'),
      hands: document.getElementById('setHandsCamera'),
      feet: document.getElementById('setFeetCamera'),
      rescan: document.getElementById('setRescan'),
      camNote: document.getElementById('setCameraNote'),
      panels: document.getElementById('setPanels'),
      close: document.getElementById('setClose'),
    };

    for (const key of ['flaps', 'pedals', 'boxes', 'gloves']) {
      this.el[key].checked = settings.get(key);
      this.el[key].addEventListener('change', () => settings.set(key, this.el[key].checked));
    }

    for (const job of ['hands', 'feet']) {
      this.el[job].addEventListener('change', () => {
        this.onAssign?.(job, this.el[job].value || null);
      });
    }
    this.el.rescan.addEventListener('click', () => this.rescan());
    this.el.close.addEventListener('click', () => this.toggle(false));

    this._buildPanelList();
    settings.onChange((key) => {
      if (key === 'collapsed' || key === 'hidden') this._syncPanelList();
    });

    this.open = false;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.root.classList.toggle('open', this.open);
    this.root.setAttribute('aria-hidden', String(!this.open));
    if (this.open) this.rescan();
  }

  /** Re-reads the attached cameras and refills both pickers. */
  async rescan() {
    const result = await this.onRescan?.();
    if (result) this.setDevices(result.cameras, result.assignment, result.named);
  }

  setDevices(cameras = [], assignment = {}, named = false) {
    for (const job of ['hands', 'feet']) {
      const el = this.el[job];
      if (!el) continue;
      el.innerHTML = '';
      if (!named) {
        el.append(new Option('start the camera first', ''));
        el.disabled = true;
        continue;
      }
      el.disabled = false;
      if (job === 'feet') el.append(new Option('none — no foot tracking', ''));
      for (const cam of cameras) el.append(new Option(cam.label, cam.deviceId));
      el.value = assignment?.[job] ?? '';
    }

    // Say what is wrong, and what to do about it, rather than showing a list
    // with one thing in it and leaving the rest to be guessed at.
    this.el.camNote.textContent = !named
      ? 'Cameras can only be named once the camera has been started once — permission has to be granted before the system will identify them.'
      : cameras.length < 2
        ? 'Only one camera found. To use a phone: plug it in, or on a Mac put it near the laptop, signed into the same Apple account with Wi-Fi and Bluetooth on — it then appears here as a Continuity Camera. Rescan once it does.'
        : `${cameras.length} cameras. The foot camera wants a low view of your feet; a phone propped against something works well. It can take a few seconds to wake.`;
  }

  _buildPanelList() {
    this.el.panels.innerHTML = '';
    for (const id of this.chrome.ids) {
      const row = document.createElement('label');
      row.className = 'set-panel-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.panel = id;
      box.addEventListener('change', () => {
        this.settings.setPanel('hidden', id, !box.checked);
      });
      const name = document.createElement('span');
      name.textContent = this.chrome.label(id).toLowerCase();
      row.append(box, name);
      this.el.panels.append(row);
    }
    this._syncPanelList();
  }

  _syncPanelList() {
    for (const box of this.el.panels.querySelectorAll('input[data-panel]')) {
      box.checked = !this.settings.isPanel('hidden', box.dataset.panel);
    }
  }
}
