import { describe, it, expect } from 'vitest';
import type { LockInfo, SessionState } from '../../shared/api';
import { contentBanner, contentBlocked, onContentBlocked, readOnlyBanner, reconcileBanners } from './Banners';

const holder: LockInfo = { user: 'marie', host: 'PC-1', pid: 42, sessionId: 's1', heartbeatAt: '2026-10-22T10:00:00.000Z' };
const placeholder: LockInfo = { user: '?', host: '?', pid: 0, sessionId: '?', heartbeatAt: new Date(0).toISOString() };
const s = (o: Partial<SessionState>): SessionState => ({ path: 'C:\\b.basecraft', fileName: 'b.basecraft', readOnly: true, locationRisk: 'local', ...o });

describe('readOnlyBanner (R23: "Reprendre" if and only if lockStale)', () => {
  it('writable base: no banner', () => expect(readOnlyBanner(s({ readOnly: false }))).toBeNull());

  it('held by a live holder: names them, no take-over', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockHolder: holder, lockStale: false })))
      .toEqual({ key: 'banner.readOnlyHeld', params: { user: 'marie', host: 'PC-1' }, takeOver: false });
  });

  it('stale lock offers the take-over', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockHolder: holder, lockStale: true }))?.takeOver).toBe(true);
  });

  it('unreadable lock (main placeholder) says so, and offers the take-over only while stale', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockHolder: placeholder, lockStale: true })))
      .toEqual({ key: 'banner.readOnlyUnreadable', takeOver: true });
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockHolder: placeholder, lockStale: false }))?.takeOver).toBe(false);
    // a real holder named '?' is not the placeholder
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockHolder: { ...holder, user: '?' }, lockStale: false }))?.key).toBe('banner.readOnlyHeld');
  });

  it('holder closed the base (no lock left): says so, not "unreadable", and offers the take-over', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', lockStale: true }))).toEqual({ key: 'banner.readOnlyReleased', takeOver: true });
  });

  it('needsRecovery: explains, take-over only while stale (hidden once refused)', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', needsRecovery: true, lockHolder: holder, lockStale: true })))
      .toEqual({ key: 'banner.needsRecovery', takeOver: true });
    expect(readOnlyBanner(s({ readOnlyReason: 'heldByOther', needsRecovery: true, lockHolder: holder, lockStale: false }))?.takeOver).toBe(false);
  });

  it('lock lost and read-only file', () => {
    expect(readOnlyBanner(s({ readOnlyReason: 'lockLost', lockStale: true }))).toEqual({ key: 'banner.lockLost', takeOver: true });
    expect(readOnlyBanner(s({ readOnlyReason: 'fileReadOnly' }))).toEqual({ key: 'banner.fileReadOnly', takeOver: false });
  });
});

describe('reconcileBanners', () => {
  const empty = { addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [], updatedRelations: [] };
  it('nothing changed: no banner', () => {
    expect(reconcileBanners(undefined)).toEqual([]);
    expect(reconcileBanners(empty)).toEqual([]);
  });
  it('relations dropped or kept without integrity are counted and named', () => {
    expect(reconcileBanners({ ...empty, removedTables: ['Clients'], removedRelations: ['ClientsCommandes'], downgradedRelations: ['A', 'B'] })).toEqual([
      { kind: 'reconcile', key: 'banner.reconcile', params: { count: 4 } },
      { kind: 'relationsRemoved', key: 'banner.relationsRemoved', params: { names: 'ClientsCommandes' } },
      { kind: 'relationsDowngraded', key: 'banner.relationsDowngraded', params: { names: 'A, B' } },
    ]);
  });
});

describe('reconcileBanners (A2-R14)', () => {
  const empty = { addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [], updatedRelations: [] };
  it('relations that followed their key are counted and named', () => {
    expect(reconcileBanners({ ...empty, updatedRelations: ['ClientsCommandes'] })).toEqual([
      { kind: 'reconcile', key: 'banner.reconcile', params: { count: 1 } },
      { kind: 'relationsUpdated', key: 'banner.relationsUpdated', params: { names: 'ClientsCommandes' } },
    ]);
  });
});

describe('contentBanner (B1: active content disabled)', () => {
  it('only a disabled state shows the bar', () => {
    expect(contentBanner(s({ content: 'disabled' }))).toEqual({ key: 'banner.contentDisabled' });
    expect(contentBanner(s({ content: 'enabled' }))).toBeNull();
    expect(contentBanner(s({ content: 'none' }))).toBeNull();
    expect(contentBanner(s({}))).toBeNull();
  });
});

describe('contentBlocked (a dismissed security bar comes back when something is blocked)', () => {
  it('calls the listeners until they unsubscribe', () => {
    let n = 0;
    const off = onContentBlocked(() => { n++; });
    contentBlocked();
    expect(n).toBe(1);
    off();
    contentBlocked();
    expect(n).toBe(1);
  });
});
