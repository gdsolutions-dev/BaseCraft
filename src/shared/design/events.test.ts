import { describe, expect, it } from 'vitest';
import { FACTURES_REPORT } from '../report/fixtures/factures';
import { PROPERTY_CATALOG } from './properties';
import { CANCELLABLE, checkEventValue, EVENTS, readEvent, sectionByName, sectionName } from './events';

describe('events', () => {
  it('reads bindings', () => {
    expect(readEvent(undefined)).toEqual({ kind: 'none' });
    expect(readEvent(null)).toEqual({ kind: 'none' });
    expect(readEvent('')).toEqual({ kind: 'none' });
    expect(readEvent('MLyon.Fermer')).toEqual({ kind: 'macro', name: 'MLyon.Fermer' });
    expect(readEvent({ embedded: { formatVersion: '1.0', items: [] } })).toEqual({ kind: 'embedded', def: { formatVersion: '1.0', items: [] } });
    expect(readEvent('[Event Procedure]')).toEqual({ kind: 'other', text: '[Event Procedure]' });
    expect(readEvent('=Fonction()')).toEqual({ kind: 'other', text: '=Fonction()' });
    expect(readEvent('a.b.c')).toEqual({ kind: 'other', text: 'a.b.c' });          // not a macro name: kept, does nothing
  });

  it('an object that is not a valid { embedded } is kept as other, with no text', () => {
    for (const v of [{}, { embedded: 'M' }, { embedded: { formatVersion: '2.0', items: [] } }, { embedded: { formatVersion: '1.0' } }, [], 42, true])
      expect(readEvent(v), JSON.stringify(v)).toEqual({ kind: 'other', text: '' });
  });

  it('checks values', () => {
    for (const ok of [undefined, '', 'M', 'M.S', 'Macro avec espace', { embedded: { formatVersion: '1.0', items: [] } }]) expect(checkEventValue(ok), String(ok)).toBeNull();
    for (const bad of ['a.b.c', '.S', 'M.', '[M]', '=1', ' M', 'M!S']) expect(checkEventValue(bad), bad).toBe('badMacroName');
    expect(checkEventValue('M'.repeat(65))).toBe('badMacroName');
    expect(checkEventValue({ embedded: { formatVersion: '2.0', items: [] } })).toBe('badEmbedded');
    expect(checkEventValue({})).toBe('badEmbedded');
    expect(checkEventValue(42)).toBe('badEmbedded');
  });

  it('closed list', () => {
    expect(EVENTS).toHaveLength(19);
    expect([...CANCELLABLE].sort()).toEqual(['BeforeInsert', 'BeforeUpdate', 'OnDelete', 'OnExit', 'OnFormat', 'OnNoData', 'OnOpen', 'OnPrint']);
    expect(PROPERTY_CATALOG.filter((d) => d.tab === 'event').map((d) => d.name).sort()).toEqual([...EVENTS].sort());
    expect(CANCELLABLE.has('OnDblClick')).toBe(false);   // R3
  });

  it('section names', () => {
    expect(sectionName('groupHeader', 1)).toBe('GroupHeader1');
    expect(sectionName('groupFooter')).toBe('GroupFooter0');
    expect(sectionName('pageFooter')).toBe('PageFooterSection');
    expect(sectionName('pageHeader')).toBe('PageHeaderSection');
    expect(['formHeader', 'detail', 'formFooter', 'reportHeader', 'reportFooter'].map((k) => sectionName(k as never))).toEqual(
      ['FormHeader', 'Detail', 'FormFooter', 'ReportHeader', 'ReportFooter']);
    expect(sectionByName(FACTURES_REPORT.sections, 'detail')).toBe(FACTURES_REPORT.sections.findIndex((s) => s.kind === 'detail'));
    expect(sectionByName(FACTURES_REPORT.sections, 'GROUPFOOTER0')).toBe(FACTURES_REPORT.sections.findIndex((s) => s.kind === 'groupFooter'));
    expect(sectionByName(FACTURES_REPORT.sections, 'Détail')).toBe(-1);   // the invariant name, not the label (R10)
    expect(sectionByName(FACTURES_REPORT.sections, 'FormHeader')).toBe(-1);
  });
});
