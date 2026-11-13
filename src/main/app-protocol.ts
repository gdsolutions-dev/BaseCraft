import { app, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { APP_SCHEME } from '../shared/python/paths';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
};
// R2: the Python worker's network rule (nothing but its own origin, wasm compilation allowed)
const WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

/** The file and headers for a bc-app://app/<path> URL, or null (other host, path leaving its root, directory, unknown type). */
export function resolveAppRequest(url: string, roots: { renderer: string; python: string }): { file: string; headers: Record<string, string> } | null {
  let u: URL;
  let path: string;
  try { u = new URL(url); path = decodeURIComponent(u.pathname); } catch { return null; }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== 'app' || path.includes('\0')) return null;
  const python = path.startsWith('/python/');
  const root = python ? roots.python : roots.renderer;
  const rel = normalize(python ? path.slice('/python/'.length) : path.slice(1));
  const back = relative(root, join(root, rel));
  if (back === '' || back.startsWith('..') || isAbsolute(back) || isAbsolute(rel) || rel.startsWith('..')) return null;
  const type = MIME[extname(rel).toLowerCase()];
  if (!type) return null;
  const headers: Record<string, string> = {
    'content-type': type,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
  };
  if (python) { // fetched from the dev server's origin too
    headers['access-control-allow-origin'] = '*';
    headers['cross-origin-resource-policy'] = 'cross-origin';
  }
  if (/^assets\/python-worker-[^/]*\.js$/.test(path.slice(1))) headers['content-security-policy'] = WORKER_CSP;
  return { file: join(root, rel), headers };
}

export function appRoots(): { renderer: string; python: string } {
  return {
    renderer: join(__dirname, '../renderer'),
    python: app.isPackaged ? join(process.resourcesPath, 'python') : join(__dirname, '../../build/python'),
  };
}

/** The Access export script (batch E2): beside the python resources when packaged, in resources/ in development. */
export function accessExportScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'access-export.ps1') : join(__dirname, '../../resources/access-export.ps1');
}

/** Serves bc-app on the default session (the main window's). After ready. */
export function registerAppProtocol(roots: { renderer: string; python: string }): void {
  protocol.handle(APP_SCHEME, async (req) => {
    const r = resolveAppRequest(req.url, roots);
    if (r) {
      try { return new Response(await readFile(r.file), { headers: r.headers }); } catch { /* missing file: 404 */ }
    }
    return new Response(null, { status: 404 });
  });
}
