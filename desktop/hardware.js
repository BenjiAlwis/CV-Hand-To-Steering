/**
 * Runs the hardware helper and relays between it and the page.
 *
 * The page is sandboxed and gets nothing from Node, which is right for a
 * page — but turning a wheel's motor and reading a serial port both need the
 * operating system. So that work lives in `wheelhelper.py`, a separate
 * process this module owns, and the page reaches it through one narrow IPC
 * channel exposed by the preload script.
 *
 * Linux only for now: the helper speaks evdev and termios. On other systems
 * this stays off and the page falls back to the Gamepad API, which reads a
 * wheel fine but cannot turn it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { ipcMain } from 'electron';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wheelhelper.py');

export class Hardware {
  constructor() {
    /** @type {import('electron').WebContents | null} */
    this.contents = null;
    this.child = null;
    this.stopped = false;
    this._restarts = 0;
    this._last = { devices: null, moza: null };

    ipcMain.handle('hw:available', () => process.platform === 'linux');
    ipcMain.on('hw:send', (event, message) => {
      if (event.sender !== this.contents) return;
      this._write(message);
    });
    // A page that reloads asks again for what it missed.
    ipcMain.on('hw:hello', (event) => {
      if (event.sender !== this.contents) return;
      for (const message of Object.values(this._last)) if (message) event.sender.send('hw:message', message);
    });
  }

  /** @param {import('electron').WebContents} contents */
  attach(contents) {
    this.contents = contents;
    if (process.platform === 'linux' && !this.child) this._start();
  }

  stop() {
    this.stopped = true;
    // Closing stdin is the helper's cue to release every effect and exit;
    // the kernel would clear them anyway when its descriptors close.
    this.child?.stdin.end();
    setTimeout(() => this.child?.kill(), 500).unref();
  }

  _start() {
    const child = spawn('python3', [HELPER], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.t in this._last) this._last[message.t] = message;
      if (this.contents && !this.contents.isDestroyed()) this.contents.send('hw:message', message);
    });

    child.on('error', (error) => {
      // No python3 on the path: say so once and stay on the Gamepad API.
      this._send({ t: 'unavailable', message: `hardware helper could not start: ${error.message}` });
      this.child = null;
    });

    child.on('exit', () => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this._send({ t: 'devices', list: [] });
      // Back off, so a helper that crashes on start does not spin.
      const delay = Math.min(10000, 500 * 2 ** this._restarts++);
      setTimeout(() => { if (!this.stopped && !this.child) this._start(); }, delay).unref();
    });

    setTimeout(() => { if (this.child === child) this._restarts = 0; }, 15000).unref();
  }

  _write(message) {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _send(message) {
    if (this.contents && !this.contents.isDestroyed()) this.contents.send('hw:message', message);
  }
}
