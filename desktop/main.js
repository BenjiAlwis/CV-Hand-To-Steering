/**
 * Wheelhouse desktop shell.
 *
 * Runs the rig in its own application window rather than a browser tab: no
 * address bar, no tabs, a dark chrome-less frame and a menu wired to the
 * camera and rig controls.
 *
 * The page is still served over HTTP from inside this process — ES modules
 * and the import map do not load from `file://`, and the loopback server is
 * simpler and less brittle than registering a custom protocol.
 */
import { app, BrowserWindow, Menu, shell, session, systemPreferences } from 'electron';
import { startServer } from '../tools/serve.mjs';

app.setName('Wheelhouse');

/** @type {{close: () => Promise<void>} | null} */
let server = null;
/** @type {BrowserWindow | null} */
let win = null;

let creating = false;

async function createWindow() {
  if (creating || (win && !win.isDestroyed())) return;
  creating = true;

  try {
    server ??= await startServer({ port: 5173 });
    const origin = new URL(server.url).origin;

    // The page is our own, served from loopback, and the only capability it
    // asks for is the camera the hand tracker runs on. Everything else is
    // refused rather than left to the default.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents.getURL().startsWith(origin) && permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
      requestingOrigin === origin && permission === 'media');

    win = new BrowserWindow({
      width: 1480,
      height: 920,
      minWidth: 960,
      minHeight: 620,
      // Matches the scene's background, so there is no white flash on launch.
      backgroundColor: '#05070a',
      title: 'Wheelhouse',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 20 },
      show: false,
      webPreferences: {
        // The page needs nothing from Node, so it gets nothing from Node.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    // Subscribe before loading. `ready-to-show` can fire while `loadURL` is
    // still being awaited, and a listener attached afterwards would miss it
    // and leave the window built but permanently hidden.
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => { win = null; });

    // Anything that would open a new window goes to the real browser instead.
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    try {
      await win.loadURL(`${server.url}/index.html?shell=desktop`);
    } catch (error) {
      console.error('failed to load the app:', error.message);
    }

    // Belt and braces: show it regardless, so a missed event or a failed load
    // still puts something on screen rather than nothing at all.
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();

    startCameraWhenPermitted();
  } finally {
    creating = false;
  }
}

/**
 * Asks macOS for the camera, then tells the page to start tracking.
 *
 * Deliberately after the window is up and deliberately not awaited inside
 * `createWindow`. On a first run the system prompt blocks until the driver
 * answers it, and asking before the window exists means an unanswered dialog
 * leaves them staring at no app at all — the same symptom as a failed launch.
 * The request also has to come from the main process: `getUserMedia` alone
 * fails the first time with no dialog shown.
 */
async function startCameraWhenPermitted() {
  if (process.platform === 'darwin') {
    try {
      const granted = await systemPreferences.askForMediaAccess('camera');
      if (!granted) return;                 // the panel explains; the rig still runs
    } catch { /* the driver can still steer with mouse and keyboard */ }
  }

  // The page may still be booting, so give its API a few moments to appear.
  for (let i = 0; i < 40; i++) {
    if (!win || win.isDestroyed()) return;
    const ready = await win.webContents
      .executeJavaScript('typeof window.wheelhouse?.camera === "function"', true)
      .catch(() => false);
    if (ready) {
      win.webContents.executeJavaScript('window.wheelhouse.camera(true)', true).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Calls into the page's menu-facing API, ignoring a window that has gone. */
const run = (expression) => () => win?.webContents.executeJavaScript(expression, true);

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: 'Wheelhouse',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Camera',
      submenu: [
        { label: 'Driver', accelerator: 'CmdOrCtrl+1', click: run('wheelhouse.view("driver")') },
        { label: 'Three-quarter', accelerator: 'CmdOrCtrl+2', click: run('wheelhouse.view("quarter")') },
        { label: 'Detail', accelerator: 'CmdOrCtrl+3', click: run('wheelhouse.view("detail")') },
        { type: 'separator' },
        { label: 'Free Orbit', accelerator: 'CmdOrCtrl+4', click: run('wheelhouse.freeCamera()') },
      ],
    },
    {
      label: 'Wheel',
      submenu: [
        { label: 'Ferrari', accelerator: 'CmdOrCtrl+Shift+1', click: run('wheelhouse.setTeam("ferrari")') },
        { label: 'Mercedes', accelerator: 'CmdOrCtrl+Shift+2', click: run('wheelhouse.setTeam("mercedes")') },
        { label: 'Red Bull', accelerator: 'CmdOrCtrl+Shift+3', click: run('wheelhouse.setTeam("redbull")') },
        { type: 'separator' },
        { label: 'Next Wheel', accelerator: 'CmdOrCtrl+T', click: run('wheelhouse.setTeam(wheelhouse.teams()[(wheelhouse.teams().findIndex(t=>t.id===wheelhouse.currentTeam())+1)%wheelhouse.teams().length].id)') },
      ],
    },
    {
      label: 'Vision',
      submenu: [
        { label: 'Start / Stop Camera', accelerator: 'CmdOrCtrl+K', click: run('wheelhouse.camera()') },
        { label: 'Set Hands Level', accelerator: 'CmdOrCtrl+E', click: run('wheelhouse.recalibrate()') },
        { type: 'separator' },
        { label: 'Shift Up', accelerator: 'CmdOrCtrl+Up', click: run('wheelhouse.shift(1)') },
        { label: 'Shift Down', accelerator: 'CmdOrCtrl+Down', click: run('wheelhouse.shift(-1)') },
      ],
    },
    {
      label: 'Rig',
      submenu: [
        { label: 'Recentre Wheel', accelerator: 'CmdOrCtrl+0', click: run('wheelhouse.recentre()') },
        { label: 'Toggle Overlay', accelerator: 'CmdOrCtrl+/', click: run('wheelhouse.toggleHud()') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Running `npm start` again should raise the window that is already open,
// not stack up a second one with its own server on the next free port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  // Defensive: if this instance somehow has no window, make one rather than
  // silently doing nothing. Running `npm start` must always end with a window
  // on screen — the alternative is a banner in the terminal and no app.
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await server?.close();
  server = null;
  // Quit on macOS too, rather than following the usual convention of staying
  // resident. A windowless instance keeps the single-instance lock and the
  // port, so the next `npm start` is refused and exits without showing
  // anything — which looks exactly like the app failing to launch.
  app.quit();
});

app.on('before-quit', async () => {
  await server?.close();
  server = null;
});
