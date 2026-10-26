import { app, BrowserWindow, Menu, powerMonitor, protocol } from 'electron';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { HEARTBEAT_MS } from './db/lock';
import { CH } from '../shared/api';
import { abandonBase, closeBase, closeVeto, hasBase, heartbeat, openBase, registerIpc, whenIdle } from './ipc';
import { fileArg, handleOpenFile, openAll } from './open-file';
import { closePrintWindows, PRINT_SCHEME, registerPrintProtocol } from './report-print';
import { defaultIconPath } from './window-icon';

if (process.env.BASECRAFT_USER_DATA) app.setPath('userData', process.env.BASECRAFT_USER_DATA);
// The print window's documents and fonts (report-print.ts): a standard scheme, so fonts/<file> resolves against the document.
protocol.registerSchemesAsPrivileged([{ scheme: PRINT_SCHEME, privileges: { standard: true, secure: true } }]);

let mainWindow: BrowserWindow | null = null;
// E2E only (unpackaged + BASECRAFT_E2E=1): Playwright's app.close() calls app.quit(), which must not wait for the
// documents' questions (a test may end on a modified design). Users never reach app.quit() with a window open.
let e2eQuitting = false;
// E2E windows stay hidden (they would take the foreground on every test); BASECRAFT_E2E_SHOW=1 shows them to debug.
// A hidden window must keep rendering at full speed, or the grid and the timers would stall.
const e2eHidden = process.env.BASECRAFT_E2E === '1' && process.env.BASECRAFT_E2E_SHOW !== '1' && !app.isPackaged;
if (e2eHidden) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); // off screen counts as occluded on Windows
}

const tick = () => {
  try { heartbeat(); } catch (e) { console.error(e); }
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'BaseCraft',
    ...(process.platform === 'darwin' ? {} : { icon: defaultIconPath() }), // macOS: the Dock shows the bundle's icon
    // Shown off screen without activation rather than hidden: a hidden window gets no animation frames, which the grid needs.
    ...(e2eHidden ? { show: false, x: -32000, y: -32000, skipTaskbar: true, focusable: false, enableLargerThanScreen: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      ...(e2eHidden ? { backgroundThrottling: false } : {}),
    },
  });
  mainWindow = win;
  // A small screen (CI runners: 1024×768) shrinks a new window to fit it (Windows on creation, macOS when shown): the e2e
  // layouts assume the full size, which the off-screen window takes again (macOS: enableLargerThanScreen).
  const fullSize = () => { const [w, h] = win.getSize(); if (w < 1280 || h < 800) win.setSize(1280, 800); };
  if (e2eHidden) {
    fullSize();
    win.once('ready-to-show', () => { win.showInactive(); fullSize(); });
  }
  // The renderer may veto: a pending row is saved first, an invalid one or a modified design asks (R24). It closes the
  // window through CH.closeAllowed. A renderer that cannot answer (crashed, reported unresponsive, or silent for
  // HUNG_MS after a request, then closed again) does not keep the window open (R26).
  let unresponsive = false;
  win.on('unresponsive', () => { unresponsive = true; });
  win.on('responsive', () => { unresponsive = false; });
  win.on('close', (e) => {
    if (e2eQuitting || unresponsive || win.webContents.isCrashed()) return;
    const step = closeVeto.request();
    if (step === 'close') return;
    e.preventDefault();
    if (step === 'ask') win.webContents.send(CH.closeRequested);
  });
  win.on('closed', () => { mainWindow = null; closePrintWindows(); void closeBase(); }); // a hung print job never keeps the app alive
  win.on('session-end', abandonBase); // Windows shutdown/logoff: before-quit is not emitted, an async close may never end
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

// A new BaseCraft process for a second base (one database = one window); macOS goes through LaunchServices.
function spawnProcess(p: string): void {
  const child = process.platform === 'darwin'
    ? spawn('open', ['-n', '-a', dirname(dirname(dirname(app.getPath('exe')))), '--args', p], { detached: true, stdio: 'ignore' })
    : spawn(process.execPath, [p], { detached: true, stdio: 'ignore' });
  child.on('error', console.error);
  child.unref();
}
const openDeps = { hasBase, open: async (f: string) => { await openBase(f); }, spawn: spawnProcess };
const openFile = (p: string) => void handleOpenFile(p, openDeps).catch(console.error);
let ready = false;
const pendingFiles: string[] = [];
// macOS delivers double-clicked files here, possibly before ready: all are queued: the first opens as the first base, the rest spawn.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (ready) openFile(p); else pendingFiles.push(p);
});

app.whenReady().then(() => {
  // The ribbon replaces the menu bar; the default menu is untranslated and would take F11 (full screen).
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerIpc(() => mainWindow);
  registerPrintProtocol();
  createWindow();
  // `electron . <file>` in dev/tests, `BaseCraft.exe <file>` once packaged, or a file queued by macOS before ready
  const first = fileArg(process.argv);
  ready = true;
  void openAll([...(first ? [first] : []), ...pendingFiles].map((f) => resolve(f)), openDeps).catch(console.error);
  setInterval(tick, HEARTBEAT_MS);
  powerMonitor.on('resume', tick);
});
// will-quit: all windows are closed and the quit was not cancelled (before-quit would close the base under a window
// that may still cancel or flush a pending row). The quit waits once for the data process to close the base (3 s at most),
// then exits (app.quit() again from here would not end the process).
let baseClosed = false;
app.on('will-quit', (e) => {
  if (baseClosed) return;
  e.preventDefault();
  baseClosed = true;
  void whenIdle().then(closeBase).finally(() => app.exit()); // after an opening or a Stop restart in progress
});
app.on('before-quit', () => { if (process.env.BASECRAFT_E2E === '1' && !app.isPackaged) e2eQuitting = true; });
app.on('window-all-closed', () => app.quit());
