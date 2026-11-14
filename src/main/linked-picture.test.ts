import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pictureKey, resolvePicture, usedPictureKeys, usedResourceNames } from '../shared/pictures';
import { inBaseFolder, readLinkedPicture, readLinkedPictures } from './linked-picture';

const root = mkdtempSync(join(tmpdir(), 'linkpic-')), dir = join(root, 'base');
mkdirSync(join(dir, 'img'), { recursive: true });
writeFileSync(join(dir, 'img', 'c.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 4]));
writeFileSync(join(root, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 5]));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
writeFileSync(join(dir, 'a.png'), png);
writeFileSync(join(dir, 'x.png'), 'not a picture');
writeFileSync(join(dir, 'big.png'), Buffer.concat([png, Buffer.alloc(1024 * 1024)]));

describe('readLinkedPicture', () => {
  it('reads a picture in the folder of the base or a subfolder, by absolute path or relative to the base file', () => {
    const base = join(dir, 'b.basecraft');
    expect(readLinkedPicture(join(dir, 'a.png'), base)).toMatch(/^data:image\/png;base64,/);
    expect(readLinkedPicture('a.png', base)).toMatch(/^data:image\/png;base64,/);
    expect(readLinkedPicture(join('img', 'c.png'), base)).toMatch(/^data:image\/png;base64,/);
    expect(readLinkedPicture('a.png', undefined)).toBeUndefined();
    expect(readLinkedPicture(join(dir, 'a.png'), undefined)).toBeUndefined();   // no base: nothing is read
  });
  it('refuses a picture outside the folder of the base (absolute or through ..)', () => {
    const base = join(dir, 'b.basecraft');
    expect(readLinkedPicture(join(root, 'outside.png'), base)).toBeUndefined();
    expect(readLinkedPicture(join('..', 'outside.png'), base)).toBeUndefined();
    expect(inBaseFolder(join(dir, 'img', 'c.png'), base)).toBe(join('img', 'c.png'));
    expect(inBaseFolder(join(root, 'outside.png'), base)).toBeUndefined();
  });
  it('refuses a non-picture, a file over 1 MB, a missing file, a network or odd path', () => {
    for (const p of [join(dir, 'x.png'), join(dir, 'big.png'), join(dir, 'none.png'), dir, '', '\\host\share\a.png', '//host/share/a.png', 'a\u0000.png'])
      expect(readLinkedPicture(p, join(dir, 'b.basecraft'))).toBeUndefined();
  });
  it('reads only link: names', () => {
    const r = readLinkedPictures(['link:' + join(dir, 'a.png'), join(dir, 'a.png'), 'Gallery'], join(dir, 'b.basecraft'));
    expect(Object.keys(r)).toEqual(['link:' + join(dir, 'a.png')]);
  });
});

describe('pictureKey', () => {
  it('keys shared and linked pictures; embedded has none', () => {
    expect(pictureKey({ PictureType: 'shared', Picture: 'Logo' })).toBe('Logo');
    expect(pictureKey({ PictureType: 'linked', Picture: 'C:\a.png' })).toBe('link:C:\a.png');
    expect(pictureKey({ Picture: 'data:image/png;base64,AA==' })).toBeUndefined();
    expect(pictureKey({ PictureType: 'linked' })).toBeUndefined();
  });
  it('resolves a linked picture from the map and lists the keys of a document', () => {
    expect(resolvePicture({ PictureType: 'linked', Picture: 'p.png' }, { 'link:p.png': 'data:image/png;base64,AA==' })).toBe('data:image/png;base64,AA==');
    expect(resolvePicture({ PictureType: 'linked', Picture: 'p.png' }, { 'p.png': 'x' })).toBeUndefined();
    const doc = { formatVersion: '1.0', recordSource: null, props: { PictureType: 'linked', Picture: 'bg.png' },
      sections: [{ kind: 'detail', height: 1, props: {}, controls: [{ kind: 'image', name: 'I', left: 0, top: 0, width: 1, height: 1, props: { PictureType: 'shared', Picture: 'Logo' } }] }] } as never;
    expect(usedPictureKeys(doc).sort()).toEqual(['Logo', 'link:bg.png']);
    expect(usedResourceNames(doc)).toEqual(['Logo']);
  });
});
