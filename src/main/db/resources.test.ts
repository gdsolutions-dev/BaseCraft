import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { PICTURE_MAX_BYTES, parsePictureDataUrl, pictureDataUrl } from '../../shared/pictures';
import { createBaseFile, openBaseFile } from './file-format';
import { saveObject } from './objects';
import { addResource, getResources, listResources, removeResource, replaceResource, resourceUsage } from './resources';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcres-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const png = (extra = 0) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, ...new Array(extra).fill(7)]);
const pngUrl = (extra = 0) => pictureDataUrl('png', png(extra));
const doc = (props: object, controls: object[] = []) => ({ formatVersion: '1.0', recordSource: null, props, sections: [{ kind: 'detail', height: 100, controls }] });
const ctl = (props: object) => ({ id: 'c1', kind: 'image', x: 0, y: 0, w: 10, h: 10, props });

it('add returns the name, a taken name gets (n), case-insensitively', () => {
  expect(addResource(db, 'logo', pngUrl())).toBe('logo');
  expect(addResource(db, 'logo', pngUrl())).toBe('logo (2)');
  expect(addResource(db, 'LOGO', pngUrl())).toBe('LOGO (3)');
  expect(listResources(db).map((r) => r.name)).toEqual(['logo', 'logo (2)', 'LOGO (3)']);
  expect(listResources(db)[0]).toEqual({ name: 'logo', type: 'png', bytes: 7 });
});

it('get returns only the existing names, byte for byte', () => {
  addResource(db, 'logo', pngUrl(5));
  const r = getResources(db, ['logo', 'nope']);
  expect(Object.keys(r)).toEqual(['logo']);
  expect(parsePictureDataUrl(r.logo)!.bytes).toEqual(png(5));
});

it('replace changes the bytes and modified, keeps created', async () => {
  addResource(db, 'logo', pngUrl());
  const before = db.prepare('SELECT created, modified FROM bc_resources').get() as { created: string; modified: string };
  await new Promise((r) => setTimeout(r, 5));
  replaceResource(db, 'LOGO', pngUrl(9));
  const after = db.prepare('SELECT created, modified FROM bc_resources').get() as { created: string; modified: string };
  expect(after.created).toBe(before.created);
  expect(after.modified).not.toBe(before.modified);
  expect(parsePictureDataUrl(getResources(db, ['logo']).logo)!.bytes).toEqual(png(9));
  expect(() => replaceResource(db, 'nope', pngUrl())).toThrow('bc:resourceNotFound');
});

it('refuses SVG, a wrong signature, an oversize image and a bad name; nothing stored', () => {
  expect(() => addResource(db, 'a', 'data:image/svg+xml;base64,PHN2Zy8+')).toThrow('bc:invalidPicture');
  expect(() => addResource(db, 'a', pngUrl().replace('image/png', 'image/jpeg'))).toThrow('bc:invalidPicture');
  expect(() => addResource(db, 'a', pngUrl(PICTURE_MAX_BYTES))).toThrow('bc:pictureTooLarge');
  expect(() => addResource(db, '\u0007', pngUrl())).toThrow('bc:invalidName');
  expect(listResources(db)).toEqual([]);
});

it('remove: unused works, used by a saved form refuses with the count, unknown is not found', () => {
  addResource(db, 'logo', pngUrl());
  addResource(db, 'other', pngUrl());
  saveObject(db, 'form', 'F1', doc({}, [ctl({ Picture: 'logo', PictureType: 'shared' })]), null);
  saveObject(db, 'report', 'R1', doc({ Picture: 'logo', PictureType: 'shared' }), null);
  saveObject(db, 'form', 'F2', doc({}, [ctl({ Picture: 'logo' })]), null); // embedded-only: not a use
  expect(resourceUsage(db, 'logo')).toEqual([{ kind: 'form', name: 'F1' }, { kind: 'report', name: 'R1' }]);
  expect(() => removeResource(db, 'logo')).toThrow('bc:resourceInUse|2');
  removeResource(db, 'other');
  expect(listResources(db).map((r) => r.name)).toEqual(['logo']);
  expect(() => removeResource(db, 'nope')).toThrow('bc:resourceNotFound');
});

it('reads tolerate a missing table', () => {
  db.exec('DROP TABLE bc_resources');
  expect(listResources(db)).toEqual([]);
  expect(getResources(db, ['a'])).toEqual({});
});

it('the " (n)" suffix keeps the name within 255 characters, and __proto__ is a name like another', () => {
  const long = 'a'.repeat(255);
  addResource(db, long, pngUrl());
  const second = addResource(db, long, pngUrl());
  expect(second).toHaveLength(255);
  expect(second.endsWith(' (2)')).toBe(true);
  addResource(db, '__proto__', pngUrl());
  expect(Object.keys(getResources(db, ['__proto__']))).toEqual(['__proto__']);
});
