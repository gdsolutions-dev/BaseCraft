import { describe, expect, it, vi } from 'vitest';
import type { DocTab } from '../state/app-state';

vi.mock('../bridge', () => ({ api: {} }));
const { dirtyDependents } = await import('./autocorrect');

const tab = (kind: DocTab['kind'], name: string, dirty: boolean): DocTab => ({ id: `${kind}${name}${dirty}`, kind, name, mode: 'design', dirty, reloadToken: 0 });

describe('dirtyDependents', () => {
  const deps = [{ kind: 'form' as const, name: 'FClients' }, { kind: 'report' as const, name: 'RVentes' }];
  it('returns a dependent open with unsaved changes', () => {
    expect(dirtyDependents([tab('form', 'FClients', true)], deps)).toEqual([deps[0]]);
  });
  it('ignores a clean one, an unrelated dirty one and the self table tab', () => {
    const tabs = [tab('report', 'RVentes', false), tab('form', 'Autre', true), tab('table', 'Clients', true)];
    expect(dirtyDependents(tabs, deps)).toEqual([]);
    const withTable = [...deps, { kind: 'table' as const, name: 'Clients' }];
    expect(dirtyDependents(tabs, withTable, { kind: 'table', name: 'Clients' })).toEqual([]);
    expect(dirtyDependents(tabs, withTable)).toEqual([{ kind: 'table', name: 'Clients' }]);
  });
});
