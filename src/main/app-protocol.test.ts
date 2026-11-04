import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveAppRequest } from './app-protocol';

const roots = { renderer: join('/r'), python: join('/p') };
const WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

describe('resolveAppRequest', () => {
  it('serves the renderer with isolation headers', () => {
    const r = resolveAppRequest('bc-app://app/index.html', roots)!;
    expect(r.file).toBe(join(roots.renderer, 'index.html'));
    expect(r.headers).toMatchObject({
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('serves python/** cross-origin', () => {
    const r = resolveAppRequest('bc-app://app/python/pyodide.asm.wasm', roots)!;
    expect(r.file).toBe(join(roots.python, 'pyodide.asm.wasm'));
    expect(r.headers).toMatchObject({
      'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
    });
  });
  it('puts the CSP on the worker chunk only', () => {
    expect(resolveAppRequest('bc-app://app/assets/python-worker-AbC123.js', roots)!.headers['content-security-policy']).toBe(WORKER_CSP);
    expect(resolveAppRequest('bc-app://app/assets/index-x.js', roots)!.headers['content-security-policy']).toBeUndefined();
  });
  it.each([
    'bc-app://app/../secret', 'bc-app://app/%2e%2e%2fsecret', 'bc-app://app/..%5Csecret', 'bc-app://other/index.html',
    'bc-app://app/python/../../x', 'bc-app://app/', 'bc-app://app/python/', 'bc-app://app/x.unknown',
    'bc-app://app/C:/x', 'bc-app://app//server/share/x.js', 'bc-app://app/a%00.js',
  ])('refuses %s', (url) => {
    expect(resolveAppRequest(url, roots)).toBeNull();
  });
  it.each([
    ['a.mjs', 'text/javascript'], ['a.js', 'text/javascript'], ['a.json', 'application/json'], ['a.zip', 'application/zip'],
    ['a.whl', 'application/zip'], ['a.css', 'text/css'], ['a.ttf', 'font/ttf'], ['a.woff2', 'font/woff2'],
    ['a.svg', 'image/svg+xml'], ['a.png', 'image/png'],
  ])('MIME of %s', (f, t) => {
    expect(resolveAppRequest(`bc-app://app/${f}`, roots)!.headers['content-type']).toBe(t);
  });
});
