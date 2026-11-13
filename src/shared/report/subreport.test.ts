// Sous-état : les bandes de l'état source dans le cadre du contrôle, filtrées par les champs pères/fils, pour chaque ligne du père.
import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../coerce';
import type { ControlDef, DesignDoc, SectionDef } from '../design/model';
import { defaultProps, type FieldType } from '../field-types';
import type { SourceField } from '../record-source';
import { FACTURES_FIELDS, FACTURES_ROWS } from './fixtures/factures';
import { itemAt } from './flow';
import { layoutReport } from './layout';
import { readReport } from './model';
import type { LaidOutBand, LaidOutReport, LayoutEnv, LayoutOpts, SubreportSource } from './types';

const FONT = { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent' };
const ctl = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>, o: Partial<ControlDef> = {}): ControlDef =>
  ({ kind, name, left: 0, top, width: 5000, height: 340, ...o, props: { ...FONT, ...props } });
const sec = (kind: SectionDef['kind'], height: number, controls: ControlDef[], props: Record<string, unknown> = {}): SectionDef => ({ kind, height, props, controls });
const doc = (sections: SectionDef[]): DesignDoc => ({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'T' }, props: { Width: 6000 }, sections });
const field = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) });

const LINES = doc([
  sec('pageHeader', 340, [ctl('label', 'PH', 0, { Caption: 'never printed' })]),
  sec('detail', 340, [ctl('textBox', 'Libellé', 0, { ControlSource: 'Libellé' })]),
  sec('reportFooter', 340, [ctl('textBox', 'Total', 0, { ControlSource: '=Count(*)' })]),
]);
const CLIENT_FIELDS = [field('Client', 'shortText')];
const master = (sub: Record<string, unknown> = {}) => doc([sec('detail', 980, [
  ctl('textBox', 'Client', 0, { ControlSource: 'Client' }),
  ctl('subform', 'S', 340, { SourceObject: 'Lignes', LinkMasterFields: 'Client', LinkChildFields: 'client', ...sub }, { height: 300, width: 5500 }),
  ctl('label', 'After', 640, { Caption: 'after' }),
], { CanGrow: true, KeepTogether: false })]);

const lines = (): SubreportSource => ({ spec: readReport(LINES, FACTURES_FIELDS), data: { fields: FACTURES_FIELDS, rows: FACTURES_ROWS } });
const env = (o: Partial<LayoutEnv> = {}): LayoutEnv => ({ locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' },
  subreport: async (name) => (name === 'Lignes' ? lines() : null), ...o });
const run = (d: DesignDoc, clients: SqlValue[], e = env(), opts?: LayoutOpts): Promise<LaidOutReport> =>
  layoutReport(readReport(d, CLIENT_FIELDS), { fields: CLIENT_FIELDS, rows: clients.map((c) => [c]) }, e, opts);
const texts = (b: LaidOutBand) => b.items.flatMap((i) => (i.kind === 'text' ? [i.lines.map((l) => l.text).join('\n')] : []));
const details = (r: LaidOutReport) => r.pages.flatMap((p) => p.bands.filter((b) => b.section === 'detail'));
const of = (b: LaidOutBand, name: string) => b.items.find((i) => i.name === name)!;

describe('subreport', () => {
  it('prints the linked rows of its source report for each master row, and grows', async () => {
    const r = await run(master(), ['MARTIN', 'Durand', 'Nobody', null], env(), { flow: true });
    const [martin, durand, nobody, none] = details(r);
    // text links compare without case; 10 lines and the subreport's own total; its Page Header is not printed
    expect(texts(martin!).filter((t) => t.startsWith('Article'))).toHaveLength(10);
    expect(texts(martin!)).toEqual(['MARTIN', ...FACTURES_ROWS.filter((x) => x[1] === 'Martin').map((x) => x[3]), '10', 'after']);
    expect(texts(durand!).at(-2)).toBe('5');
    expect(texts(nobody!)).toEqual(['Nobody', '0', 'after']);   // no row: its Report Footer alone
    expect(texts(none!)).toEqual(['', '0', 'after']);           // a Null link shows no record
    // the frame grows to 11 bands; what is below moves down by as much, the section follows
    expect(of(martin!, 'S')).toMatchObject({ kind: 'rect', top: 340, height: 11 * 340 });
    expect(of(martin!, 'After')).toMatchObject({ top: 640 + 11 * 340 - 300 });
    expect(martin!.height).toBe(980 + 11 * 340 - 300);
    expect(r.issues).toEqual([]);
    // Layout view: a point on a line of the subreport picks the subreport's control
    expect(itemAt(r, martin!.left + 100, martin!.top + 340 + 500)).toBe('S');
  });

  it('no link fields: every row; Can Grow off: the frame keeps its height; Can Shrink: an empty one disappears', async () => {
    const all = await run(master({ LinkMasterFields: '', LinkChildFields: '' }), ['x'], env(), { flow: true });
    expect(texts(details(all)[0]!).at(-2)).toBe('75');
    const fixed = details(await run(master({ CanGrow: false }), ['Martin'], env(), { flow: true }))[0]!;
    expect(fixed.height).toBe(980);
    expect(texts(fixed)).toEqual(['Martin', FACTURES_ROWS.find((x) => x[1] === 'Martin')![3], 'after']);   // only what starts inside the 300 twips
    const empty: SubreportSource = { spec: readReport(doc([sec('detail', 340, [])]), FACTURES_FIELDS), data: { fields: FACTURES_FIELDS, rows: [] } };
    const shrunk = details(await run(master({ CanShrink: true }), ['Martin'], env({ subreport: async () => empty }), { flow: true }))[0]!;
    expect(shrunk.items.map((i) => i.name)).toEqual(['Client', 'After']);
  });

  it('a subreport taller than a page is cut between its bands', async () => {
    const r = await run(master(), ['Dupont']);   // 60 lines: 20,740 twips
    expect(r.pages.length).toBeGreaterThan(1);
    const printed = r.pages.flatMap((p) => p.bands.flatMap(texts)).filter((t) => t.startsWith('Article'));
    expect(printed).toEqual(FACTURES_ROWS.filter((x) => x[1] === 'Dupont').map((x) => x[3]));   // each line once, whole
    for (const p of r.pages) for (const b of p.bands) for (const i of b.items) if (i.kind === 'text') expect(i.top + i.height).toBeLessThanOrEqual(b.height);
  });

  it('reads its source once, and lays out each link value once', async () => {
    let reads = 0;
    const r = await run(master(), ['Martin', 'Martin', 'Durand'], env({ subreport: async () => { reads++; return lines(); } }));
    expect(reads).toBe(1);
    expect(details(r)).toHaveLength(3);
  });

  it('missing, recursive or badly linked: an issue and an empty frame; no loader: an empty frame', async () => {
    const issue = async (d: DesignDoc, e: LayoutEnv) => { const r = await run(d, ['Martin'], e); expect(texts(details(r)[0]!)).toEqual(['Martin', 'after']); return r.issues; };
    expect(await issue(master({ SourceObject: 'Absent' }), env())).toEqual([{ code: 'subreportMissing', control: 'S', detail: 'Absent' }]);
    expect(await issue(master(), env({ subPath: ['lignes'] }))).toEqual([{ code: 'subreportRecursive', control: 'S', detail: 'Lignes' }]);
    expect(await issue(master({ LinkChildFields: 'Nope' }), env())).toEqual([{ code: 'subreportBadLink', control: 'S', detail: 'Lignes' }]);
    expect(await issue(master({ LinkChildFields: '' }), env())).toEqual([{ code: 'subreportBadLink', control: 'S', detail: 'Lignes' }]);
    const { subreport: _none, ...bare } = env();
    expect(await issue(master(), bare)).toEqual([]);
    expect(await issue(master({ SourceObject: '' }), env())).toEqual([]);
  });

  it('a subreport holding itself stops at the first level', async () => {
    const self: SubreportSource = { spec: readReport(master({ SourceObject: 'Moi', LinkMasterFields: '', LinkChildFields: '' }), CLIENT_FIELDS), data: { fields: CLIENT_FIELDS, rows: [['a'], ['b']] } };
    const r = await layoutReport(self.spec, self.data, env({ subreport: async () => self }), { flow: true });
    expect(r.issues).toEqual([{ code: 'subreportRecursive', control: 'S', detail: 'Moi' }]);
    expect(texts(details(r)[0]!)).toEqual(['a', 'a', 'after', 'b', 'after', 'after']);   // one level of itself, then empty frames
  });
});
