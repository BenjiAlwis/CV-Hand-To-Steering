/**
 * Opens Wheelhouse in its desktop window.
 *
 *   npm start
 *
 * Exists mainly to clear ELECTRON_RUN_AS_NODE before launching. VS Code's
 * integrated terminal exports that variable, and with it set any Electron
 * binary quietly runs as plain Node instead — so `electron .` dies on its
 * first `import { BrowserWindow } from 'electron'` with an error that says
 * nothing about why.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronBinary from 'electron';   // under plain Node this is the binary's path

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

process.stdout.write('\n  \x1b[36mWHEELHOUSE\x1b[0m  opening the rig window…\n  \x1b[2mclose the window or press ctrl-c to quit\x1b[0m\n\n');

const child = spawn(electronBinary, [ROOT, ...process.argv.slice(2)], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

const startedAt = Date.now();

child.on('exit', (code, signal) => {
  // Electron only holds a single instance. If it exits almost immediately and
  // without an error, it handed off to a copy that was already running — and
  // if that copy is wedged, the launch looks like it did nothing at all.
  if (!signal && (code ?? 0) === 0 && Date.now() - startedAt < 2500) {
    process.stdout.write(
      '  \x1b[33mWheelhouse was already running\x1b[0m, so this launch handed off to it.\n' +
      '  If no window appeared, that copy is wedged — close it with:\n\n' +
      '    pkill -f "Electron.app/Contents/MacOS/Electron"\n\n' +
      '  then run npm start again.\n\n',
    );
  }
  process.exit(signal ? 0 : code ?? 0);
});

// ctrl-c in the terminal closes the window rather than orphaning it.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
