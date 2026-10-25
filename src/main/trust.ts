// Whether a base's active content is enabled (spec 4.8, rulings R4 and R5): an administrator's trusted folders (a system file,
// read, never written) or this user's approvals (<userData>/trust.json, tied to db_uuid + fingerprint). Nothing read from the
// base itself decides trust.
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, sep } from 'node:path';
import type { ContentState } from '../shared/api';
import type { ActiveContent } from './db/active-content';

export type { ContentState };
export interface TrustConfig { trustedFolders: { path: string; subfolders: boolean }[] }

const MAX_APPROVALS = 500;

/** R4: the administrator's file. */
export function systemTrustPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') return `${env.ProgramData ?? 'C:\\ProgramData'}\\BaseCraft\\trust.json`;
  if (platform === 'darwin') return '/Library/Application Support/BaseCraft/trust.json';
  return '/etc/basecraft/trust.json';
}

/** Absent, unreadable or invalid → no trusted folder; invalid entries are dropped. */
export function readTrustConfig(path: string): TrustConfig {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { trustedFolders: [] }; }
  const folders = (raw as { trustedFolders?: unknown } | null)?.trustedFolders;
  if (!Array.isArray(folders)) return { trustedFolders: [] };
  return {
    trustedFolders: folders.flatMap((f: unknown) => {
      const { path: p, subfolders } = (f ?? {}) as { path?: unknown; subfolders?: unknown };
      return typeof p === 'string' && p !== '' ? [{ path: p, subfolders: subfolders === true }] : [];
    }),
  };
}

const real = (p: string): string | null => { try { return realpathSync.native(p); } catch { return null; } };

/** The file's real folder is a configured folder, or lies under one marked `subfolders`. Relative configured paths are ignored. */
export function inTrustedFolder(file: string, cfg: TrustConfig, platform: NodeJS.Platform): boolean {
  const dir = real(dirname(file));
  if (dir === null) return false;
  const norm = (p: string) => (platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p);
  const d = norm(dir);
  return cfg.trustedFolders.some((f) => {
    if (!isAbsolute(f.path)) return false;
    const t = norm(real(f.path) ?? f.path); // a configured folder through a link or a short name still matches
    return d === t || (f.subfolders && d.startsWith(t.endsWith(sep) ? t : t + sep));
  });
}

type Approval = { dbUuid: string; fingerprint: string; at: string };

/** This user's approvals: one per base (its latest approved fingerprint), the 500 most recent. ponytail: two copies of a base
 *  (Save As keeps db_uuid) edited in turn ask again each time; key by db_uuid + fingerprint if that is ever seen. */
export class ApprovalStore {
  private list: Approval[] = [];

  constructor(private readonly file: string) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const items = (raw as { approvals?: unknown } | null)?.approvals;
      if (Array.isArray(items)) {
        this.list = items.filter((a): a is Approval => a !== null && typeof a === 'object'
          && typeof a.dbUuid === 'string' && typeof a.fingerprint === 'string' && typeof a.at === 'string');
      }
    } catch { /* absent or unreadable: nothing approved */ }
  }

  isApproved(dbUuid: string, fingerprint: string): boolean {
    return dbUuid !== '' && fingerprint !== '' && this.list.some((a) => a.dbUuid === dbUuid && a.fingerprint === fingerprint);
  }

  /** Remembered at once (temp file + rename). A write failure is logged: the approval still holds for this session. */
  approve(dbUuid: string, fingerprint: string, now = new Date()): void {
    this.list = [...this.list.filter((a) => a.dbUuid !== dbUuid), { dbUuid, fingerprint, at: now.toISOString() }]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_APPROVALS);
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ approvals: this.list }), 'utf8');
      renameSync(tmp, this.file);
    } catch (e) {
      console.error(e);
    }
  }
}

export function contentState(a: ActiveContent, dbUuid: string, file: string, deps: { store: ApprovalStore; cfg: TrustConfig; platform: NodeJS.Platform }): ContentState {
  if (!a.present) return 'none';
  return inTrustedFolder(file, deps.cfg, deps.platform) || deps.store.isApproved(dbUuid, a.fingerprint) ? 'enabled' : 'disabled';
}

/** R5, after this user's own write of objects: the content stays enabled, for its new fingerprint, only when the content found
 *  just before the write is the content enabled (changed elsewhere meanwhile: it asks again). `enabled`: the fingerprint enabled
 *  ('' : no content), null when disabled. Returns the fingerprint to enable now, null: disabled. */
export function enabledAfterOwnWrite(enabled: string | null, before: string | null, after: string): string | null {
  return enabled !== null && before === enabled ? after : null;
}
