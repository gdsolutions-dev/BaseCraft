// BaseCraft Runtime: the full application's build config, as a second product packaged from out-runtime/ (scripts/runtime-stage.mjs).
// The full application owns .basecraft (rank Owner); the Runtime only offers itself in "Open with": on Windows through
// build/runtime-installer.nsh (no fileAssociations here, which would take the extension's default), elsewhere as a Viewer.
// extraResources are inherited: electron-builder resolves them against the project folder, not out-runtime/.
const { build } = require('./package.json');
const { fileAssociations: [{ rank, ...assoc }], ...rest } = build;

module.exports = {
  ...rest,
  appId: 'dev.gdsolutions.basecraft.runtime',
  productName: 'BaseCraft Runtime',
  artifactName: 'BaseCraft-Runtime-${version}-${os}-${arch}.${ext}',
  directories: { buildResources: 'build', app: 'out-runtime', output: 'dist-runtime' },
  files: ['**/*', '!**/node_modules/**'], // as the full build: the bundles need no package (else the root node_modules are packed)
  nsis: { ...build.nsis, include: 'build/runtime-installer.nsh' },
  mac: { ...build.mac, fileAssociations: [{ ...assoc, role: 'Viewer', rank: 'Alternate' }] },
  linux: { ...build.linux, executableName: 'basecraft-runtime', fileAssociations: [{ ...assoc, role: 'Viewer' }] },
};
