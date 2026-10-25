import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { ApprovalStore, contentState, enabledAfterOwnWrite, inTrustedFolder, readTrustConfig, systemTrustPath } from './trust';

let root: string;
beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bctrust-')));
  fs.mkdirSync(join(root, 'sub'));
  fs.mkdirSync(join(root, 'apps', 'x'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('system paths', () => {
  expect(systemTrustPath('linux', {})).toBe('/etc/basecraft/trust.json');
  expect(systemTrustPath('darwin', {})).toBe('/Library/Application Support/BaseCraft/trust.json');
  expect(systemTrustPath('win32', { ProgramData: 'D:\\PD' })).toBe('D:\\PD\\BaseCraft\\trust.json');
  expect(systemTrustPath('win32', {})).toBe('C:\\ProgramData\\BaseCraft\\trust.json');
});

it('trusted folders', () => {
  const cfg = { trustedFolders: [{ path: root, subfolders: false }, { path: join(root, 'apps'), subfolders: true }] };
  expect(inTrustedFolder(join(root, 'a.basecraft'), cfg, process.platform)).toBe(true);
  expect(inTrustedFolder(join(root, 'sub', 'a.basecraft'), cfg, process.platform)).toBe(false);
  expect(inTrustedFolder(join(root, 'apps', 'x', 'a.basecraft'), cfg, process.platform)).toBe(true);
  expect(inTrustedFolder(join(root, 'apps', 'a.basecraft'), cfg, process.platform)).toBe(true);
  expect(inTrustedFolder(join(`${root}-apps`, 'a.basecraft'), cfg, process.platform)).toBe(false); // a sibling sharing the prefix
  expect(inTrustedFolder(join(root, 'missing', 'a.basecraft'), cfg, process.platform)).toBe(false);
  expect(inTrustedFolder('a.basecraft', { trustedFolders: [{ path: '.', subfolders: true }] }, process.platform)).toBe(false); // relative: ignored
  if (process.platform === 'win32') expect(inTrustedFolder(join(root.toUpperCase(), 'a.basecraft'), cfg, 'win32')).toBe(true);
});

it('invalid config is empty', () => {
  const f = join(root, 'trust.json');
  expect(readTrustConfig(join(root, 'absent.json'))).toEqual({ trustedFolders: [] });
  for (const text of ['{', '[]', 'null', JSON.stringify({ trustedFolders: [{ path: 3 }] }), JSON.stringify({ trustedFolders: 'x' })]) {
    fs.writeFileSync(f, text);
    expect(readTrustConfig(f), text).toEqual({ trustedFolders: [] });
  }
  fs.writeFileSync(f, JSON.stringify({ trustedFolders: [{ path: 3 }, null, { path: root, subfolders: true }, { path: '/x' }] }));
  expect(readTrustConfig(f)).toEqual({ trustedFolders: [{ path: root, subfolders: true }, { path: '/x', subfolders: false }] });
});

it('approvals', () => {
  const f = join(root, 'trust.json');
  const s = new ApprovalStore(f);
  s.approve('u1', 'f1');
  expect(new ApprovalStore(f).isApproved('u1', 'f1')).toBe(true);
  expect(s.isApproved('u1', 'f2')).toBe(false);
  for (let i = 0; i < 501; i++) s.approve(`u${i + 2}`, 'x', new Date(2026, 0, 1, 0, 0, i));
  const t = new ApprovalStore(f);
  expect(t.isApproved('u2', 'x')).toBe(false); // the oldest are dropped
  expect(t.isApproved('u502', 'x')).toBe(true);
  expect(t.isApproved('u1', 'f1')).toBe(true);
  expect((JSON.parse(fs.readFileSync(f, 'utf8')) as { approvals: unknown[] }).approvals).toHaveLength(500);
  fs.writeFileSync(f, '{');
  expect(new ApprovalStore(f).isApproved('u1', 'f1')).toBe(false); // unreadable: nothing approved
});

it('content state', () => {
  const file = join(root, 'sub', 'a.basecraft');
  const deps = { store: new ApprovalStore(join(root, 'trust.json')), cfg: { trustedFolders: [] }, platform: process.platform };
  const present = { present: true, fingerprint: 'a'.repeat(64) };
  expect(contentState({ present: false, fingerprint: '' }, 'u', file, deps)).toBe('none');
  expect(contentState(present, 'u', file, deps)).toBe('disabled');
  deps.store.approve('u', present.fingerprint);
  expect(contentState(present, 'u', file, deps)).toBe('enabled');
  expect(contentState({ ...present, fingerprint: 'b'.repeat(64) }, 'u', file, deps)).toBe('disabled'); // a change asks again
  expect(contentState(present, 'u', file, { ...deps, store: new ApprovalStore(join(root, 'other.json')), cfg: { trustedFolders: [{ path: join(root, 'sub'), subfolders: false }] } })).toBe('enabled');
});

it('R5: an own write keeps the content enabled only if nothing changed it elsewhere first', () => {
  expect(enabledAfterOwnWrite('F', 'F', 'G')).toBe('G'); // enabled: the new content is approved
  expect(enabledAfterOwnWrite('', '', 'G')).toBe('G'); // opened with none: what this user adds is approved
  expect(enabledAfterOwnWrite('', '', '')).toBe('');
  expect(enabledAfterOwnWrite('F', 'X', 'G')).toBeNull(); // changed elsewhere before the write: asks again
  expect(enabledAfterOwnWrite('', 'X', 'G')).toBeNull();
  expect(enabledAfterOwnWrite('F', null, 'G')).toBeNull(); // could not be read before
  expect(enabledAfterOwnWrite(null, 'F', 'G')).toBeNull(); // opened disabled: stays disabled
});
