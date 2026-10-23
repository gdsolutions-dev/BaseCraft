// Export PDF et impression d'un état : une fenêtre de travail cachée par tâche, sur la partition bc-print, qui ne charge que
// le document (en mémoire) et les polices embarquées (liste blanche). Jamais montrée ni focalisée ; aucun script de page ;
// aucune requête hors bc-print. Une police embarquée qui ne se charge pas arrête tout (bc:fontMissing) : jamais de repli.
import { app, BrowserWindow, session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrintRequest } from '../shared/api';
import { FONT_FILES } from '../shared/fonts';

export const PRINT_SCHEME = 'bc-print';
const PREFIX = `${PRINT_SCHEME}://doc/`;
const CSP = `default-src 'none'; style-src 'unsafe-inline'; font-src ${PRINT_SCHEME}:; img-src data:`;
const FONTS = new Set(Object.values(FONT_FILES).flatMap((f) => Object.values(f)));
/** Documents of the jobs under way, by id (bc-print://doc/<id>). */
const docs = new Map<string, string>();

const e2e = () => process.env.BASECRAFT_E2E === '1' && !app.isPackaged;

/** What a bc-print URL serves: a job's document, or an embedded font file (exact allowlist). Anything else: null (404). */
export function resolvePrintRequest(url: string, docs: ReadonlyMap<string, string>): { kind: 'doc'; html: string } | { kind: 'font'; file: string } | null {
  if (!url.startsWith(PREFIX)) return null;
  let rest: string;
  try { rest = decodeURIComponent(url.slice(PREFIX.length)); } catch { return null; } // decoded once
  if (rest.includes('..') || rest.includes('\\')) return null;
  if (rest.startsWith('fonts/')) {
    const file = rest.slice('fonts/'.length);
    return FONTS.has(file) ? { kind: 'font', file } : null; // exact names: no subfolder, no other file
  }
  const html = docs.get(rest);
  return html === undefined ? null : { kind: 'doc', html };
}

/** The embedded fonts: the build's (out/renderer/fonts, inside the package once packaged), the sources' in dev; e2e may
 *  point elsewhere (BASECRAFT_E2E_FONTS_DIR) to test a missing face. */
export function fontsDir(): string {
  if (e2e() && process.env.BASECRAFT_E2E_FONTS_DIR) return process.env.BASECRAFT_E2E_FONTS_DIR;
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return join(__dirname, '../../src/renderer/public/fonts');
  return join(__dirname, '../renderer/fonts');
}

/** File name proposed for the PDF: the report's name, characters Windows refuses replaced by '_', cut to 200 characters
 *  (file systems refuse a name past 255 bytes or UTF-16 units; an external tool may name a report at length, C8), without
 *  trailing dots and spaces; a Windows device name (CON, NUL, COM1…, extension or not) gets a leading '_'. */
export function pdfFileName(name: string): string {
  const stem = Array.from(name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')).slice(0, 200).join('').replace(/[. ]+$/, '');
  return `${stem === '' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(stem) ? `_${stem}` : stem}.pdf`;
}

/** Writes `data` to `path` through a sibling temp file renamed over it: a failure (read-only file, full disk) removes only
 *  the temp file, never the file already there, and never leaves it truncated. `write`: tests force a failure. */
export async function replaceFile(path: string, data: Uint8Array, write: typeof writeFile = writeFile): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await write(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** E2E only: the URLs the print partition refused, and the print jobs answered without the system dialog. */
const e2eLog = { blocked: [] as string[], printed: 0 };

/** Serves bc-print on its own partition (never the main window's), refuses every permission and every other URL. After ready. */
export function registerPrintProtocol(): void {
  const ses = session.fromPartition(PRINT_SCHEME);
  ses.protocol.handle(PRINT_SCHEME, async (req) => {
    const r = resolvePrintRequest(req.url, docs);
    if (r?.kind === 'doc') return new Response(r.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
    if (r?.kind === 'font') {
      try {
        // allowlisted name, but readFile follows links: fontsDir() must stay a folder the app owns, never a user-writable one
        return new Response(await readFile(join(fontsDir(), r.file)), { headers: { 'content-type': 'font/ttf' } });
      } catch { /* missing file: 404, the font check reports it */ }
    }
    return new Response(null, { status: 404 });
  });
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((d, cb) => {
    // data: never reaches the network (images of the report); everything else but bc-print is cancelled
    const ok = d.url.startsWith(`${PRINT_SCHEME}:`) || d.url.startsWith('data:');
    if (!ok && e2e() && e2eLog.blocked.length < 100) e2eLog.blocked.push(d.url);
    cb({ cancel: !ok });
  });
  if (e2e()) (globalThis as { __bcPrintE2E?: typeof e2eLog }).__bcPrintE2E = e2eLog;
}

// Loads every face the document declares, then waits for document.fonts.ready: the families that did not load.
const FONT_CHECK = 'Promise.all([...document.fonts].map(f => f.load().catch(() => null))).then(() => document.fonts.ready)'
  + '.then(() => [...document.fonts].filter(f => f.status !== "loaded").map(f => f.family))';

/** Loading the document and checking its fonts: past this, the work window is taken as hung. Not applied to the job itself
 *  (the system print dialog stays open as long as the user wants). */
const LOAD_TIMEOUT_MS = 30_000;
/** Work windows alive: destroyed with the main window, so a hung job never keeps the app running. */
const printWindows = new Set<BrowserWindow>();

export function closePrintWindows(): void {
  for (const w of printWindows) if (!w.isDestroyed()) w.destroy();
}

/** Runs `job` on the document loaded in a hidden work window, once every embedded face is loaded; destroys the window.
 *  A renderer that dies, hangs, fails to load or is destroyed rejects bc:printFailed. */
async function withPrintWindow<T>(req: PrintRequest, job: (wc: WebContents) => Promise<T>): Promise<T> {
  const id = randomUUID();
  docs.set(id, req.html);
  const win = new BrowserWindow({
    show: false, skipTaskbar: true, focusable: false,
    webPreferences: { partition: PRINT_SCHEME, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  printWindows.add(win);
  let timer: NodeJS.Timeout | undefined;
  let over = false; // the window is destroyed on purpose at the end
  try {
    const wc = win.webContents;
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const dead = new Promise<never>((_, reject) => {
      const fail = (why: string) => () => { if (over) return; console.error(`print window: ${why}`); reject(new Error('bc:printFailed')); };
      wc.once('render-process-gone', fail('renderer gone'));
      wc.once('unresponsive', fail('unresponsive'));
      wc.once('did-fail-load', fail('load failed'));
      win.once('closed', fail('destroyed'));
    });
    const hung = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('bc:printFailed')), LOAD_TIMEOUT_MS); });
    const missing: unknown = await Promise.race([dead, hung, win.loadURL(PREFIX + id).catch(() => { throw new Error('bc:printFailed'); })
      .then(() => wc.executeJavaScript(FONT_CHECK))]);
    clearTimeout(timer);
    if (!Array.isArray(missing) || missing.length) throw new Error('bc:fontMissing');
    return await Promise.race([dead, job(wc)]);
  } finally {
    over = true;
    clearTimeout(timer);
    docs.delete(id);
    printWindows.delete(win);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** A4 pages, sized by the document's @page, no margin (the report's margins are in the pages). Rejects bc:fontMissing. */
export function renderToPdf(req: PrintRequest): Promise<Buffer> {
  return withPrintWindow(req, (wc) => wc.printToPDF({
    pageSize: 'A4', landscape: req.landscape, printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
  }));
}

/** The system print dialog. E2E: the document is loaded and its fonts checked, then 'printed' without any dialog. */
export function printDocument(req: PrintRequest): Promise<'printed' | 'canceled'> {
  return withPrintWindow(req, (wc) => {
    if (e2e()) { e2eLog.printed++; return Promise.resolve('printed'); }
    return new Promise((resolve, reject) => {
      try {
        wc.print({ silent: false, printBackground: true, landscape: req.landscape, pageSize: 'A4', margins: { marginType: 'none' } }, (ok, reason) => {
          if (ok) resolve('printed');
          else if (reason === 'cancelled') resolve('canceled');
          else { console.error('print failed:', reason); reject(new Error('bc:printFailed')); }
        });
      } catch (e) {
        console.error(e);
        reject(new Error('bc:printFailed'));
      }
    });
  });
}
