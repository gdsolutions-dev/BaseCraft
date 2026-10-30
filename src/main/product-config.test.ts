import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// The two products' electron-builder configs (the full build in package.json, the Runtime's own file): read as electron-builder reads them.
const require = createRequire(import.meta.url);
const full = require('../../package.json').build;
const rt = require('../../electron-builder.runtime.cjs');

describe('product configs', () => {
  it('two products, two identities', () => {
    expect([full.appId, rt.appId]).toEqual(['dev.gdsolutions.basecraft', 'dev.gdsolutions.basecraft.runtime']);
    expect(rt.productName).toBe('BaseCraft Runtime');
    expect(rt.directories).toMatchObject({ app: 'out-runtime', output: 'dist-runtime' });
  });

  it('the full application owns .basecraft', () => {
    expect(full.fileAssociations[0]).toMatchObject({ ext: 'basecraft', rank: 'Owner' });
    expect(rt.fileAssociations).toBeUndefined();
    expect(rt.mac.fileAssociations[0]).toMatchObject({ ext: 'basecraft', role: 'Viewer', rank: 'Alternate' });
    expect(rt.nsis.include).toBe('build/runtime-installer.nsh');
  });

  it('signing configs refuse to run without a thumbprint', () => {
    const sha1 = process.env.BASECRAFT_SIGN_SHA1;
    delete process.env.BASECRAFT_SIGN_SHA1;
    try {
      expect(() => require('../../electron-builder.sign.cjs')).toThrow('BASECRAFT_SIGN_SHA1');
      expect(() => require('../../electron-builder.runtime.sign.cjs')).toThrow('BASECRAFT_SIGN_SHA1');
    } finally {
      if (sha1 !== undefined) process.env.BASECRAFT_SIGN_SHA1 = sha1;
    }
  });
});
