// C4 R10, G2: the main process's credential store. A fake safeStorage: encryptString = 'enc:' + text.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, refusedKey, type SafeStorageLike } from './credentials';

const K = 'postgresql://db.example:5432/ventes';
const cred = { user: 'ana', password: 's3cret' };
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s),
  decryptString: (b) => { const s = b.toString(); if (!s.startsWith('enc:')) throw new Error('cannot decrypt'); return s.slice(4); },
  getSelectedStorageBackend: () => 'gnome_libsecret',
};

let dir: string;
let file: string;
let store: CredentialStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bccred-'));
  file = join(dir, 'credentials.json');
  store = new CredentialStore(file, safe, 'win32');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('CredentialStore', () => {
  it('forget drops a password the server refused, from memory and disk (M6: never pushed again)', () => {
    store.set(K, cred, true);
    store.set('other', cred, true);
    store.forget(K);
    expect(store.get(K)).toBeNull();
    expect(new CredentialStore(file, safe).get(K)).toBeNull();
    expect(new CredentialStore(file, safe).get('other')).toEqual(cred);
    store.forget('none'); // nothing held: nothing changes
  });

  it('refusedKey reads the key of a needsLogin refusal, after a prefix', () => {
    expect(refusedKey(new Error(`Error invoking remote method 'bc:x': Error: bc:linkUnavailable|needsLogin|${K}`))).toBe(K);
    expect(refusedKey(new Error(`bc:linkUnavailable|cannotConnect|db.example:5432/ventes`))).toBeNull();
    expect(refusedKey('bc:linkUnavailable|needsLogin|')).toBeNull();
    // C6 Task 8: a stored credential not used by a file not trusted is no refusal: main keeps it
    expect(refusedKey(new Error(`Error invoking remote method 'bc:x': Error: bc:linkUnavailable|needsLogin|${K}|untrusted`))).toBeNull();
  });

  it('a remembered password is stored encrypted, never in clear', () => {
    store.set(K, cred, true);
    expect(readFileSync(file, 'utf8')).not.toContain('s3cret');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ [K]: { user: 'ana', password: Buffer.from('enc:s3cret').toString('base64') } });
    expect(new CredentialStore(file, safe).get(K)).toEqual(cred);
    expect(new CredentialStore(file, safe).user(K)).toBe('ana');
  });

  it('Linux with basic_text: kept for the session, never on disk', () => { // G2
    const s = new CredentialStore(file, { ...safe, getSelectedStorageBackend: () => 'basic_text' }, 'linux');
    expect(s.canStore()).toBe(false);
    s.set(K, cred, true);
    expect(existsSync(file)).toBe(false);
    expect(s.get(K)).toEqual(cred);
  });

  it('canStore: unknown backend on Linux, or no encryption anywhere, stores nothing', () => {
    expect(new CredentialStore(file, { ...safe, getSelectedStorageBackend: () => 'unknown' }, 'linux').canStore()).toBe(false);
    expect(new CredentialStore(file, { ...safe, getSelectedStorageBackend: undefined }, 'linux').canStore()).toBe(false);
    expect(new CredentialStore(file, { ...safe, isEncryptionAvailable: () => false }, 'win32').canStore()).toBe(false);
    expect(new CredentialStore(file, safe, 'linux').canStore()).toBe(true);
    expect(store.canStore()).toBe(true);
  });

  it('not remembered: memory only', () => {
    store.set(K, cred, false);
    expect(existsSync(file)).toBe(false);
    expect(store.get(K)).toEqual(cred);
    expect(new CredentialStore(file, safe).get(K)).toBeNull();
  });

  it('unticking Remember removes the stored entry', () => {
    const other = 'postgresql://autre:5432/x';
    store.set(other, { user: 'bob', password: 'b' }, true);
    store.set(K, cred, true);
    store.set(K, cred, false);
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(disk)).toEqual([other]);
    expect(store.get(K)).toEqual(cred);
  });

  it('a keyring that fails to encrypt: memory only, set never throws', () => {
    const s = new CredentialStore(file, { ...safe, encryptString: () => { throw new Error('keyring locked'); } }, 'win32');
    expect(() => s.set(K, cred, true)).not.toThrow();
    expect(existsSync(file)).toBe(false);
    expect(s.get(K)).toEqual(cred);
  });

  it.skipIf(process.platform === 'win32')('the file is readable by its owner only (0600)', () => {
    store.set(K, cred, true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('an undecryptable or malformed entry reads as none; an unreadable file as empty', () => {
    writeFileSync(file, JSON.stringify({ [K]: { user: 'ana', password: Buffer.from('plain').toString('base64') }, x: 1, y: { user: 2 } }));
    const s = new CredentialStore(file, safe);
    expect(s.get(K)).toBeNull();
    expect(s.get('x')).toBeNull();
    expect(s.get('y')).toBeNull();
    expect(s.user(K)).toBe('ana');
    writeFileSync(file, '{');
    expect(new CredentialStore(file, safe).get(K)).toBeNull();
    new CredentialStore(file, safe).set(K, cred, true); // rewrites a damaged file
    expect(new CredentialStore(file, safe).get(K)).toEqual(cred);
  });
});
