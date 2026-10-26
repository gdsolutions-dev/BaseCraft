// The window's icon (R9): BaseCraft's, or the base's own, a PNG the renderer decoded and re-encoded to at most 256 x 256.
// The main process never decodes a picture it was not given in that form: the header is read first, then nativeImage checks.
import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import { join } from 'node:path';
import { pngSize } from '../shared/png';

const MAX_WINDOW_ICON = 256;

/** BaseCraft's own icon: a resource of the package (extraResources), build/icon.png in the sources. */
export function defaultIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build/icon.png');
}

/** null: BaseCraft's icon. A PNG that claims, or that nativeImage reads as, empty or larger than 256 x 256 rejects bc:badIcon.
 *  macOS: no window icon, nothing is applied (the Dock shows BaseCraft's). `png` has passed iconBytes (a PNG ≤ 1 MiB). */
export function setWindowIcon(win: BrowserWindow, png: Uint8Array | null): void {
  let img: NativeImage | null = null;
  if (png) {
    // the size the header claims: a small file may still claim a picture too big to decode
    const claimed = pngSize(png);
    if (!claimed || claimed.width > MAX_WINDOW_ICON || claimed.height > MAX_WINDOW_ICON) throw new Error('bc:badIcon');
    img = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
    const { width, height } = img.getSize();
    if (img.isEmpty() || width > MAX_WINDOW_ICON || height > MAX_WINDOW_ICON) throw new Error('bc:badIcon');
  }
  // E2E only (unpackaged + BASECRAFT_E2E=1, as __bcPrintE2E): what the last call chose, on every platform. Never reachable over IPC.
  if (process.env.BASECRAFT_E2E === '1' && !app.isPackaged) {
    (globalThis as { __bcIconE2E?: { last: 'default' | { width: number; height: number } } }).__bcIconE2E = { last: img ? img.getSize() : 'default' };
  }
  if (process.platform === 'darwin') return;
  win.setIcon(img ?? defaultIconPath());
}
