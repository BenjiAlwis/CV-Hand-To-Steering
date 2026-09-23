/**
 * Static file server for the project.
 *
 * Used two ways: run directly it serves in a browser, and the desktop shell
 * (`desktop/main.js`) imports `startServer` to host the app inside its own
 * window. Either way the files must go over HTTP — ES modules and the import
 * map will not load from a `file://` path.
 *
 *   node tools/serve.mjs [--port 5173] [--no-open]
 *
 * No dependencies, so there is nothing to install before the first run.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  // MediaPipe's model bundle; the browser only ever fetches it as bytes.
  '.task': 'application/octet-stream',
};

/**
 * Is anything already answering on this port?
 *
 * Worth checking by hand rather than relying on EADDRINUSE. Binding
 * 127.0.0.1 succeeds even when another process holds the IPv6 wildcard on the
 * same port — and then `localhost` may resolve to ::1 and hand you the *other*
 * server's files, which is a genuinely baffling thing to debug.
 */
function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: 'localhost' });
    const done = (busy) => { socket.destroy(); resolve(busy); };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * @param {{port?: number, root?: string, attempts?: number}} options
 * @returns {Promise<{url: string, port: number, requested: number, close: () => Promise<void>}>}
 */
export async function startServer({ port = 5173, root = ROOT, attempts = 12 } = {}) {
  const requested = port;
  let remaining = attempts;
  while (remaining > 0 && await probe(port)) {
    port += 1;
    remaining -= 1;
  }

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const target = path.join(root, url === '/' ? 'index.html' : url);

    // Never serve anything outside the project directory.
    if (!path.resolve(target).startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(target, (err, body) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${url}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        // Always revalidate, so an edit shows up on reload rather than after a
        // hard refresh you have to remember to do.
        'Cache-Control': 'no-cache',
      }).end(body);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requested,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/* ─────────────────────────────── CLI ─────────────────────────────── */

const runDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly) {
  const args = process.argv.slice(2);
  const valueOf = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const { url, port, requested, close } = await startServer({
    port: Number(valueOf('--port', 5173)),
  });
  const shown = `http://localhost:${port}`;

  process.stdout.write(
    `\n  \x1b[36mWHEELHOUSE\x1b[0m  stage 1 — environment & wheel\n` +
    `  serving   ${shown}${port !== requested ? `  \x1b[2m(${requested} was busy)\x1b[0m` : ''}\n` +
    `  press     \x1b[2mctrl-c to stop\x1b[0m\n\n`,
  );

  if (!args.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? ['open', [shown]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', shown]]
      : ['xdg-open', [shown]];
    const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`  (could not open a browser — visit ${shown})\n`));
    child.unref();
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await close();
      process.stdout.write('\n  stopped\n\n');
      process.exit(0);
    });
  }
}
