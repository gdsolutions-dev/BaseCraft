// Server credentials (C4 R10, G2), main process only: in memory for the session; on disk, in <userData>/credentials.json, only
// when the user ticks « Mémoriser » and the OS keyring encrypts (safeStorage). Never logged, never sent back to the renderer.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Credentials } from './connectors/connector';

export interface SafeStorageLike { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string; getSelectedStorageBackend?(): string }
type Stored = Record<string, { user: string; password: string /* base64 of safeStorage.encryptString */ }>;

/** The key of a refusal `bc:linkUnavailable|needsLogin|<key>` (db-host has no credential for it: none pushed, or the server
 *  refused it), else null. `…|<key>|untrusted` (C6 Task 8: a file not trusted, the stored credential not used) is no refusal. */
export function refusedKey(e: unknown): string | null {
  const m = /\bbc:linkUnavailable\|needsLogin\|(.+?)(\|untrusted)?$/.exec(e instanceof Error ? e.message : String(e));
  return m && !m[2] ? m[1]! : null;
}

export class CredentialStore {
  private readonly memory = new Map<string, Credentials>();

  constructor(private readonly file: string, private readonly safe: SafeStorageLike, private readonly platform: NodeJS.Platform = process.platform) {}

  /** G2: false on Linux when the backend is 'basic_text' or 'unknown', and wherever encryption is unavailable. */
  canStore(): boolean {
    if (!this.safe.isEncryptionAvailable()) return false;
    if (this.platform !== 'linux') return true;
    const backend = this.safe.getSelectedStorageBackend?.();
    return backend !== undefined && backend !== 'basic_text' && backend !== 'unknown';
  }

  /** Memory first, then the file (an undecryptable entry: null). */
  get(key: string): Credentials | null {
    const held = this.memory.get(key);
    if (held) return held;
    const e = this.read()[key];
    if (!e) return null;
    try {
      const c = { user: e.user, password: this.safe.decryptString(Buffer.from(e.password, 'base64')) };
      this.memory.set(key, c);
      return c;
    } catch {
      return null; // another user's or machine's keyring, or a damaged entry: asked again
    }
  }

  /** In memory for the session; on disk when `remember` and canStore(); `remember` false removes a stored entry. Atomic write. */
  set(key: string, c: Credentials, remember: boolean): void {
    this.memory.set(key, c);
    const stored = this.read();
    if (remember && this.canStore()) {
      try {
        stored[key] = { user: c.user, password: this.safe.encryptString(c.password).toString('base64') };
      } catch {
        return; // the keyring locked or gone since canStore(): this session only, the login still succeeds
      }
    } else if (!remember && key in stored) delete stored[key];
    else return;
    this.write(stored);
  }

  /** M6: a credential the server refused, gone from memory and disk (never pushed again at a data process restart). */
  forget(key: string): void {
    this.memory.delete(key);
    const stored = this.read();
    if (!(key in stored)) return;
    delete stored[key];
    this.write(stored);
  }

  /** Atomic write. */
  private write(stored: Stored): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 }); // hosts and user names: owner only (POSIX)
      renameSync(tmp, this.file);
    } catch (e) {
      console.error((e as Error).message); // a path error: the credential still holds for this session
    }
  }

  user(key: string): string | null {
    return this.memory.get(key)?.user ?? this.read()[key]?.user ?? null;
  }

  /** The well-formed entries of the file; absent or unreadable: none. */
  private read(): Stored {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')); } catch { return {}; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) =>
      v !== null && typeof v === 'object' && typeof (v as Stored[string]).user === 'string' && typeof (v as Stored[string]).password === 'string')) as Stored;
  }
}
