// Report events (B2 Task 10): On Format / On Print through the layout hooks, On Open and On No Data before the layout,
// [Reports]! while laid out. The shell is the real one, its dialogs stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasecraftApi, RecordSourceRef, SourcePage, SourcePageRequest } from '../../shared/api';
import type { DesignDoc, SectionKind } from '../../shared/design/model';
import { localeInfo } from '../../shared/locale-format';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import type { SourceInfo } from '../../shared/record-source';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from '../../shared/report/fixtures/factures';
import { layoutReport } from '../../shared/report/layout';
import { readReport } from '../../shared/report/model';
import type { LaidOutReport, LayoutEnv } from '../../shared/report/types';
import type { ModalApi } from '../shell/Modal';

const showMessageBox = vi.fn(async (_m: unknown, _a: { message: string }) => {});
vi.mock('../macro/MessageBoxDialog', () => ({ showMessageBox }));
const showMacroFailed = vi.fn(async () => {});
vi.mock('../macro/MacroFailedDialog', () => ({ showMacroFailed }));
vi.mock('./ReportPreviewView', () => ({ outputSavedReport: vi.fn() }));
(globalThis as unknown as { window: { basecraft: Partial<BasecraftApi> } }).window = {
  basecraft: { app: { beep: async () => {} } as unknown as BasecraftApi['app'] },
};
const { setMacroShell } = await import('../macro/macro-shell');
const { reportEvents } = await import('./report-events');
const { layoutSavedReport } = await import('./load');

const m = (items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const below1 = (...items: MacroItem[]) => ({ embedded: m([{ k: 'if', branches: [{ cond: '[Montant] < 1', items }] }]) });
const withSectionProp = (doc: DesignDoc, kind: SectionKind, prop: string, value: unknown): DesignDoc =>
  ({ ...doc, sections: doc.sections.map((s) => (s.kind === kind ? { ...s, props: { ...s.props, [prop]: value } } : s)) });
const withReportProp = (doc: DesignDoc, prop: string, value: unknown): DesignDoc => ({ ...doc, props: { ...doc.props, [prop]: value } });

const frEnv = (o: Partial<LayoutEnv> = {}): LayoutEnv =>
  ({ locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' }, ...o });
const lay = (doc: DesignDoc) => layoutReport(readReport(doc, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS }, { ...frEnv(), hooks: reportEvents(doc, 'F').hooks });
const bands = (r: LaidOutReport) => r.pages.flatMap((p) => p.bands);
const detailBands = (r: LaidOutReport) => bands(r).filter((b) => b.section === 'detail');
const texts = (b: LaidOutReport['pages'][number]['bands'][number]) => b.items.flatMap((i) => (i.kind === 'text' ? i.lines.map((l) => l.text) : [])).join(' ');
const groupFooterText = (r: LaidOutReport, client: string) => texts(bands(r).find((b) => b.section === 'groupFooter' && texts(b).includes(client))!);

const modal = { confirm: vi.fn(), prompt: vi.fn(), custom: vi.fn() } as unknown as ModalApi;
beforeEach(() => {
  vi.clearAllMocks();
  setMacroShell({ dispatch: vi.fn(), modal, tabs: () => [], active: () => null, contentEnabled: () => true, closeTab: vi.fn(), closeBase: vi.fn(),
    quit: vi.fn(), region: () => localeInfo('fr-FR'), lang: () => 'fr', showError: vi.fn() });
});

/** A saved report whose source has `rows`; `pages` counts the pages read. */
function fakeApi(doc: DesignDoc, rows = FACTURES_ROWS) {
  const api = {
    pages: 0,
    objects: { get: async (_k: string, name: string) => ({ name, definition: doc }) },
    sources: {
      describe: async (): Promise<SourceInfo> => ({ fields: FACTURES_FIELDS, updatable: false, parameters: [] }),
      page: async (_: RecordSourceRef, r: SourcePageRequest): Promise<SourcePage> => {
        api.pages++;
        return { rows: rows.slice(r.offset, r.offset + r.limit), rowids: [], total: rows.length };
      },
    },
  };
  return api as typeof api & Pick<BasecraftApi, 'objects' | 'sources'>;
}

describe('report events', () => {
  it('a report without events lays out as with none', async () => {
    const r = await lay(FACTURES_REPORT);
    expect(Object.keys(reportEvents(FACTURES_REPORT, 'F').hooks)).toEqual(['onBand']);   // no On Format / On Print: the counting shortcut stays
    expect(JSON.stringify(r)).toBe(JSON.stringify(await layoutReport(readReport(FACTURES_REPORT, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS }, frEnv())));
  });

  it('On Format hides the detail of small amounts', async () => {
    const withoutEvents = await lay(FACTURES_REPORT);
    const doc = withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', below1(act('SetProperty', { ControlName: 'Detail', Property: 'visible', Value: 'Non' })));
    const r = await lay(doc);
    expect(detailBands(r)).toHaveLength(10 + 3);   // Martin 10, Durand 12,35 / 7,65 / 100,00
    expect(groupFooterText(r, 'Dupont')).toBe(groupFooterText(withoutEvents, 'Dupont'));   // totals still count every row (Access)
  });

  it('SetProperty on a control (visible, value) and on the section height, for this band only (R9)', async () => {
    const doc = withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', below1(
      act('SetProperty', { ControlName: 'Libelle', Property: 'visible', Value: 'Non' }),
      act('SetProperty', { ControlName: 'Montant', Property: 'value', Value: '"petit"' }),
      act('SetProperty', { ControlName: 'detail', Property: 'height', Value: '1' })));
    const d = detailBands(await lay(doc));
    expect(d).toHaveLength(75);
    const small = d.filter((b) => texts(b).includes('petit'));
    expect(small).toHaveLength(62);
    expect(small.every((b) => b.height === 567 && !texts(b).includes('Article'))).toBe(true);
    expect(d.filter((b) => !texts(b).includes('petit')).every((b) => b.height === 340 && texts(b).includes('Article'))).toBe(true);
  });

  it('CancelEvent in On Format drops the band; On Print cancel leaves the space', async () => {
    const plain = await lay(FACTURES_REPORT);
    const formatted = await lay(withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', below1(act('CancelEvent'))));
    expect(detailBands(formatted)).toHaveLength(13);
    const printed = await lay(withSectionProp(FACTURES_REPORT, 'detail', 'OnPrint', below1(act('CancelEvent'))));
    expect(detailBands(printed).map((b) => [b.top, b.height])).toEqual(detailBands(plain).map((b) => [b.top, b.height]));
    expect(detailBands(printed).filter((b) => b.items.length === 0)).toHaveLength(62);
  });

  it('a bare [Name] is the band\'s control, else a field of its row; an unknown name fails the macro (and cancels, R7)', async () => {
    const doc = withSectionProp(FACTURES_REPORT, 'groupHeader', 'OnFormat', { embedded: m([act('MessageBox', { Message: '=[Client] & "/" & [N°]' })]) });
    await lay(doc);
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toContain('Dupont/' + FACTURES_ROWS.find((r) => r[1] === 'Dupont')![0]);
    const bad = await lay(withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', { embedded: m([act('MessageBox', { Message: '=[Inconnu]' })]) }));
    expect(detailBands(bad)).toHaveLength(0);
    expect(showMacroFailed).toHaveBeenCalled();
  });

  it('On No Data cancelled: no layout', async () => {
    const doc = withReportProp(withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', { embedded: m([act('Beep')]) }), 'OnNoData', { embedded: m([act('MessageBox', { Message: 'Aucune facture' }), act('CancelEvent')]) });
    expect(await reportEvents(doc, 'F').noData()).toBe(true);
    await expect(layoutSavedReport(fakeApi(doc, []), 'F', frEnv(), async () => null, undefined, undefined, undefined, (d) => reportEvents(d, 'F')))
      .rejects.toThrow('bc:actionCancelled');
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['Aucune facture', 'Aucune facture']);
    // not cancelled: an empty report, as A5
    const quiet = withReportProp(FACTURES_REPORT, 'OnNoData', { embedded: m([act('Beep')]) });
    const r = await layoutSavedReport(fakeApi(quiet, []), 'F', frEnv(), async () => null, undefined, undefined, undefined, (d) => reportEvents(d, 'F'));
    expect(detailBands(r)).toHaveLength(0);
  });

  it('On Open cancelled before any row is read; On Close only once opened', async () => {
    const doc = withReportProp(withReportProp(FACTURES_REPORT, 'OnOpen', { embedded: m([act('CancelEvent')]) }), 'OnClose', { embedded: m([act('MessageBox', { Message: 'fermé' })]) });
    const api = fakeApi(doc);
    const ready = vi.fn();
    const ev = reportEvents(doc, 'F');
    await expect(layoutSavedReport(api, 'F', frEnv(), async () => null, undefined, ready, undefined, () => ev)).rejects.toThrow('bc:actionCancelled');
    expect(api.pages).toBe(0);
    expect(ready).not.toHaveBeenCalled();
    await ev.close();
    expect(showMessageBox).not.toHaveBeenCalled();   // never opened: no On Close

    const open = withReportProp(doc, 'OnOpen', '');
    const ev2 = reportEvents(open, 'F');
    await layoutSavedReport(fakeApi(open), 'F', frEnv(), async () => null, undefined, ready, undefined, () => ev2);
    expect(ready).toHaveBeenCalledOnce();   // only On Close (after the output): the progress box shows
    await ev2.close(); await ev2.close();
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['fermé']);
  });

  it('[Reports]! in its own expressions reads the band being formatted, with or without hooks', async () => {
    const own: DesignDoc = { ...FACTURES_REPORT, sections: FACTURES_REPORT.sections.map((s) => s.kind !== 'detail' ? s : { ...s, controls: [...s.controls,
      { kind: 'textBox', name: 'Qui', left: 9400, top: 0, width: 1300, height: 340, props: { ControlSource: '=[Reports]![F]![Client] & "/" & [Reports]![F]![Montant]', FontName: 'Liberation Sans', FontSize: 10, CanGrow: true } }] }) };
    const expected = FACTURES_ROWS.map((r) => `${r[1]}/${String(r[4]).replace('.', ',')}`).sort();
    const shown = (r: LaidOutReport) => detailBands(r).map((b) => b.items.flatMap((i) => (i.kind === 'text' && i.name === 'Qui' ? i.lines.map((l) => l.text) : [])).join('')).sort();
    const env = { ...frEnv(), member: (await import('../form/form-instances')).memberValue };
    for (const doc of [own, withSectionProp(own, 'detail', 'OnFormat', { embedded: m([act('Beep')]) })]) {
      const r = await layoutSavedReport(fakeApi(doc), 'F', env, async () => null, undefined, undefined, undefined, (d) => reportEvents(d, 'F'));
      expect(shown(r)).toEqual(expected);   // each band its own row (Montant: the control already read)
    }
  });

  it('On Close: once, after an On Open still running, after the event macros still running', async () => {
    const doc = withReportProp(withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', { embedded: m([act('MessageBox', { Message: 'format' })]) }),
      'OnClose', { embedded: m([act('MessageBox', { Message: 'fermé' })]) });
    let answer!: () => void;
    showMessageBox.mockImplementationOnce(async () => { await new Promise<void>((r) => { answer = r; }); });
    const ev = reportEvents(withReportProp(doc, 'OnOpen', { embedded: m([act('MessageBox', { Message: 'ouvert' })]) }), 'F');
    const opening = ev.open();
    await vi.waitFor(() => expect(answer).toBeDefined());
    await ev.close();                       // closed while On Open waits in its message box: nothing yet
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['ouvert']);
    answer();
    expect(await opening).toBe(true);       // the report goes no further
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['ouvert', 'fermé']);
    await ev.close();
    expect(showMessageBox).toHaveBeenCalledTimes(2);

    showMessageBox.mockClear();
    const ev2 = reportEvents(doc, 'F');
    await ev2.open();
    let release!: () => void;
    showMessageBox.mockImplementationOnce(async () => { await new Promise<void>((r) => { release = r; }); });
    const e = { section: 'detail', formatCount: 1, page: 1, values: {}, visible: {}, sectionVisible: true, cancel: false, height: 340, field: () => null } as const;
    void ev2.hooks.onFormat!({ ...e, values: {}, visible: {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    const closing = ev2.close();
    await Promise.resolve();
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['format']);   // not inside the On Format macro
    release();
    await closing;
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['format', 'fermé']);
  });

  it('On Close waits for an event macro still running even when a later one fails outright', async () => {
    const doc = withReportProp(withSectionProp(withSectionProp(FACTURES_REPORT, 'detail', 'OnFormat', { embedded: m([act('MessageBox', { Message: 'format' })]) }),
      'groupHeader', 'OnFormat', 'MAbsente'), 'OnClose', { embedded: m([act('MessageBox', { Message: 'fermé' })]) });
    const ev = reportEvents(doc, 'F');
    await ev.open();
    let release!: () => void;
    showMessageBox.mockImplementationOnce(async () => { await new Promise<void>((r) => { release = r; }); });
    const e = { section: 'detail', formatCount: 1, page: 1, values: {}, visible: {}, sectionVisible: true, cancel: false, height: 340, field: () => null } as const;
    void ev.hooks.onFormat!({ ...e, values: {}, visible: {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    showMacroFailed.mockRejectedValueOnce(new Error('boom'));   // the second macro's run rejects
    await ev.hooks.onFormat!({ ...e, section: 'groupHeader', groupLevel: 0, values: {}, visible: {} } as never).catch(() => {});
    const closing = ev.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['format']);   // On Close not yet
    release();
    await closing;
    expect(showMessageBox.mock.calls.map((c) => c[1].message)).toEqual(['format', 'fermé']);
  });

  it('[Reports]! stays readable until the last registration is released', async () => {
    const ev = reportEvents(FACTURES_REPORT, 'F');
    const { resolveObjectMember } = await import('../form/form-instances');
    const first = ev.register(), second = ev.register();   // a print while the preview lays out
    ev.hooks.onBand({ section: 'detail', formatCount: 1, page: 1, values: { Client: { t: 'str', v: 'Dupont' } }, visible: {}, sectionVisible: true, cancel: false, height: 340, field: () => null } as never);
    first();
    expect(await resolveObjectMember(['Reports', 'F', 'Client'])).toEqual({ t: 'str', v: 'Dupont' });
    second();
    await expect(resolveObjectMember(['Reports', 'F', 'Client'])).rejects.toThrow(/notOpen/);
  });

  it('[Reports]! reads the band being formatted, only while laid out', async () => {
    const doc = withSectionProp(FACTURES_REPORT, 'groupHeader', 'OnFormat', { embedded: m([act('MessageBox', { Message: '=[Reports]![F]![Client]' })]) });
    await layoutSavedReport(fakeApi(doc), 'F', frEnv(), async () => null, undefined, undefined, undefined, (d) => reportEvents(d, 'F'));
    expect(showMessageBox.mock.calls[0]![1].message).toBe('Dupont');
    const { resolveObjectMember } = await import('../form/form-instances');
    await expect(resolveObjectMember(['Reports', 'F', 'Client'])).rejects.toThrow(/notOpen/);
  });
});
