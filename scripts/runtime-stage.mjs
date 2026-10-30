// Stages the Runtime build's package folder, out-runtime/ (run by electron.vite.config.ts once the main process is built):
// the package.json Electron reads for `electron out-runtime` (and the packaged app, which packages this same folder) and the
// icon the unpackaged window takes (main/window-icon.ts: app.getAppPath()/build/icon.png).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { version, description, author, homepage } = JSON.parse(readFileSync('package.json', 'utf8'));
const pkg = { name: 'basecraft-runtime', productName: 'BaseCraft Runtime', version, description, author, homepage, main: 'main/index.js' };
mkdirSync('out-runtime/build', { recursive: true });
writeFileSync('out-runtime/package.json', `${JSON.stringify(pkg, null, 2)}\n`);
copyFileSync('build/icon.png', 'out-runtime/build/icon.png');
