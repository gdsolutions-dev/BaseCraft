import { describe, expect, it } from 'vitest';
import type { DesignDoc } from './design/model';
import { isResourceName, parsePictureDataUrl, PICTURE_ACCEPT, PICTURE_KINDS, PICTURE_MAX_BYTES, pictureDataUrl, readPictureType, resolvePicture,
  resourceNameFromFile, sniffPicture, usedResourceNames } from './pictures';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [...'GIF89a'].map((c) => c.charCodeAt(0));
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([1, 2, 3, 4], [...'WEBP'].map((c) => c.charCodeAt(0)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const sized = (head: number[], n: number) => { const a = new Uint8Array(n); a.set(head); return a; };
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('constants', () => {
  it('limit and accept', () => {
    expect(PICTURE_MAX_BYTES).toBe(1048576);
    expect(PICTURE_KINDS).toEqual(['png', 'jpeg', 'gif', 'webp']);
    expect(PICTURE_ACCEPT).toBe('image/png,image/jpeg,image/gif,image/webp');
  });
});

describe('sniffPicture', () => {
  it('recognises the four formats', () => {
    expect(sniffPicture(Uint8Array.from(PNG))).toBe('png');
    expect(sniffPicture(Uint8Array.from(JPEG))).toBe('jpeg');
    expect(sniffPicture(Uint8Array.from(GIF))).toBe('gif');
    expect(sniffPicture(Uint8Array.from(WEBP))).toBe('webp');
  });
  it('refuses svg and noise', () => {
    expect(sniffPicture(new TextEncoder().encode('<svg xmlns="x"/>'))).toBeNull();
    expect(sniffPicture(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
    expect(sniffPicture(new Uint8Array(0))).toBeNull();
  });
});

describe('parsePictureDataUrl', () => {
  it('accepts a real PNG', () => {
    const r = parsePictureDataUrl(PNG_1X1);
    expect(r?.kind).toBe('png');
    expect(r?.bytes.length).toBeGreaterThan(8);
  });
  it('round-trips with pictureDataUrl', () => {
    expect(pictureDataUrl('png', Uint8Array.from(PNG))).toBe(`data:image/png;base64,${b64(Uint8Array.from(PNG))}`);
  });
  it('refuses what is not a valid picture', () => {
    expect(parsePictureDataUrl(42)).toBeNull();
    expect(parsePictureDataUrl('logo')).toBeNull();
    expect(parsePictureDataUrl(`data:image/svg+xml;base64,${b64(new TextEncoder().encode('<svg/>'))}`)).toBeNull();
    expect(parsePictureDataUrl(`data:image/jpeg;base64,${b64(Uint8Array.from(PNG))}`)).toBeNull();   // signature != declared type
    expect(parsePictureDataUrl('data:image/png;base64,@@@@')).toBeNull();
    expect(parsePictureDataUrl('data:image/png;base64,')).toBeNull();
    expect(parsePictureDataUrl('data:image/png,abc')).toBeNull();
    expect(parsePictureDataUrl(`data:image/png;base64,${'A'.repeat(8_000_000)}`)).toBeNull();   // trop long : refusé sans décodage
  });
  it('checks the size', () => {
    expect(parsePictureDataUrl(`data:image/png;base64,${b64(sized(PNG, PICTURE_MAX_BYTES))}`)?.bytes.length).toBe(PICTURE_MAX_BYTES);
    expect(parsePictureDataUrl(`data:image/png;base64,${b64(sized(PNG, PICTURE_MAX_BYTES + 1))}`)).toBeNull();
  });
});

describe('resource names', () => {
  it('resourceNameFromFile', () => {
    expect(resourceNameFromFile('logo.final.PNG')).toBe('logo.final');
    expect(resourceNameFromFile('a\u0000b.png')).toBe('ab');
    expect(resourceNameFromFile('  x  .png')).toBe('x');
    expect(resourceNameFromFile(`${'a'.repeat(300)}.png`)).toHaveLength(255);
  });
  it('isResourceName', () => {
    expect(isResourceName('logo')).toBe(true);
    expect(isResourceName('')).toBe(false);
    expect(isResourceName(' x')).toBe(false);
    expect(isResourceName('a\u0001')).toBe(false);
    expect(isResourceName('a'.repeat(256))).toBe(false);
    expect(isResourceName(3)).toBe(false);
  });
});

describe('picture type and resolution', () => {
  it('readPictureType', () => {
    expect(readPictureType('shared')).toBe('shared');
    expect(readPictureType('embedded')).toBe('embedded');
    expect(readPictureType('linked')).toBe('embedded');
    expect(readPictureType(undefined)).toBe('embedded');
  });
  it('resolvePicture', () => {
    const res = { logo: PNG_1X1 };
    expect(resolvePicture({ Picture: PNG_1X1 }, res)).toBe(PNG_1X1);
    expect(resolvePicture({ PictureType: 'shared', Picture: 'logo' }, res)).toBe(PNG_1X1);
    expect(resolvePicture({ PictureType: 'shared', Picture: 'gone' }, res)).toBeUndefined();
    expect(resolvePicture({ Picture: 'logo' }, res)).toBeUndefined();
    const pngAsJpeg = PNG_1X1.replace('image/png', 'image/jpeg');   // incorporée avant F3 : se dessine comme avant
    expect(resolvePicture({ Picture: pngAsJpeg }, res)).toBe(pngAsJpeg);
    expect(resolvePicture({}, res)).toBeUndefined();
  });
});

describe('usedResourceNames', () => {
  const ctl = (name: string, props: Record<string, unknown>, children?: DesignDoc['sections'][0]['controls']) =>
    ({ kind: 'image' as const, name, left: 0, top: 0, width: 1, height: 1, props, ...(children ? { children } : {}) });
  it('walks props, controls, children, tab pages; distinct; shared only', () => {
    const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { PictureType: 'shared', Picture: 'bg' },
      sections: [{ kind: 'detail', height: 1, props: {}, controls: [
        ctl('a', { PictureType: 'shared', Picture: 'logo' }),
        ctl('b', { Picture: 'emb' }),
        { ...ctl('tab', {}, [ctl('c', { PictureType: 'shared', Picture: 'deep' }), ctl('d', { PictureType: 'shared', Picture: 'logo' })]), kind: 'tabControl' },
      ] }] };
    expect(usedResourceNames(doc).sort()).toEqual(['bg', 'deep', 'logo']);
  });
});
