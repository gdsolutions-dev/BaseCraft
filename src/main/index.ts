import { app, BrowserWindow, Menu, powerMonitor } from 'electron';
import { join, resolve } from 'node:path';
import { FILE_EXTENSION } from './db/file-format';
import { HEARTBEAT_MS } from './db/lock';
import { CH } from '../shared/api';
import { closeBase, closeVeto, currentSession, openBase, registerIpc } from './ipc';

if (process.env.BASECRAFT_USER_DATA) app.setPath('userData', process.env.BASECRAFT_USER_DATA);

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
  try { currentSession()?.tick(); } catch (e) { console.error(e); }
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'BaseCraft',
    // Shown off screen without activation rather than hidden: a hidden window gets no animation frames, which the grid needs.
    ...(e2eHidden ? { show: false, x: -32000, y: -32000, skipTaskbar: true, focusable: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      ...(e2eHidden ? { backgroundThrottling: false } : {}),
    },
  });
  mainWindow = win;
  if (e2eHidden) win.once('ready-to-show', () => win.showInactive());
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
  win.on('closed', () => { mainWindow = null; closeBase(); });
  win.on('session-end', closeBase); // Windows shutdown/logoff: before-quit is not emitted
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  // The ribbon replaces the menu bar; the default menu is untranslated and would take F11 (full screen).
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerIpc(() => mainWindow);
  createWindow();
  // `electron . <file>` in dev/tests, `BaseCraft.exe <file>` once packaged
  const arg = process.argv.slice(1).find((a) => a.toLowerCase().endsWith(FILE_EXTENSION));
  if (arg) {
    try { openBase(resolve(arg)); } catch (e) { console.error(e); }
  }
  setInterval(tick, HEARTBEAT_MS);
  powerMonitor.on('resume', tick);
});
// will-quit: all windows are closed and the quit was not cancelled (before-quit would close the base under a window
// that may still cancel or flush a pending row).
app.on('will-quit', closeBase);
app.on('before-quit', () => { if (process.env.BASECRAFT_E2E === '1' && !app.isPackaged) e2eQuitting = true; });
app.on('window-all-closed', () => app.quit());
