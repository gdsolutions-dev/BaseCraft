import { describe, expect, it } from 'vitest';
import { MAX_PRINT_HTML_CHARS, type RecordSourceRef, type SourceInfo, type SourcePage, type SourcePageRequest } from '../../shared/api';
import type { LayoutEnv } from '../../shared/report/types';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from '../../shared/report/fixtures/factures';
import { DATA_PAGE, docParameters, layoutSavedReport, loadDocData, loadReportData, printRequestFor, zoomFor } from './load';

const FIELDS = [{ name: 'N', type: 'number' as const, props: { type: 'number' as const } }] as unknown as SourceInfo['fields'];

function fakeSources(total: number, onPage?: (n: number) => void) {
  const calls: SourcePageRequest[] = [];
  const api = {
    calls,
    sources: {
      describe: async (_: RecordSourceRef): Promise<SourceInfo> => ({ fields: FIELDS, updatable: false, parameters: [] }),
      page: async (_: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage> => {
        calls.push(req);
        onPage?.(calls.length);
        const n = Math.max(0, Math.min(req.limit, total - req.offset));
        return { rows: Array.from({ length: n }, (_, i) => [req.offset + i]), rowids: [], total };
      },
    },
  };
  return api;
}

describe('loadReportData', () => {
  it('loads all pages', async () => {
    const api = fakeSources(2 * DATA_PAGE + 203);
    const d = await loadReportData(api, { kind: 'table', name: 'T' });
    expect(d.rows).toHaveLength(2 * DATA_PAGE + 203);
    expect(d.rows[2 * DATA_PAGE + 202]).toEqual([2 * DATA_PAGE + 202]);
    expect(d.fields).toBe(FIELDS);
    expect(api.calls.map((c) => c.offset)).toEqual([0, DATA_PAGE, 2 * DATA_PAGE]);
    expect(api.calls.every((c) => c.limit === DATA_PAGE)).toBe(true);
  });

  it('passes the parameters and stops on an empty source', async () => {
    const api = fakeSources(0);
    const d = await loadReportData(api, { kind: 'table', name: 'T' }, { P: 1 });
    expect(d.rows).toEqual([]);
    expect(api.calls).toEqual([{ offset: 0, limit: DATA_PAGE, params: { P: 1 } }]);
  });

  it('stops when aborted', async () => {
    const ac = new AbortController();
    const api = fakeSources(2 * DATA_PAGE + 203, () => ac.abort());
    const e = await loadReportData(api, { kind: 'table', name: 'T' }, undefined, ac.signal).catch((x: unknown) => x);
    expect((e as Error).name).toBe('AbortError');
    expect(api.calls).toHaveLength(1);
  });
});

describe('Where Condition (R8)', () => {
  const CLIENTS = [['Dupont', 'Lyon'], ['Martin', 'LYON'], ['Durand', 'Paris'], ['Éric', 'Lyôn']];
  const wheres: (string | undefined)[] = [];
  const api = {
    objects: { get: async (_k: string, name: string) => ({ name, definition: FACTURES_REPORT }) },
    sources: {
      describe: async (): Promise<SourceInfo> => ({ fields: FIELDS, updatable: false, parameters: [] }),
      page: async (_: RecordSourceRef, r: SourcePageRequest): Promise<SourcePage> => { // the main process applies it; here one condition
        wheres.push(r.where);
        const rows = r.where === '[Ville] = "Paris"' ? CLIENTS.filter((c) => c[1] === 'Paris') : CLIENTS;
        return { rows: rows.slice(r.offset, r.offset + r.limit), rowids: [], total: rows.length };
      },
    },
  };
  it('report rows restricted by where', async () => {
    expect((await loadReportData(api, { kind: 'table', name: 'Clients' }, undefined, undefined, '[Ville] = "Paris"')).rows).toEqual([['Durand', 'Paris']]);
    expect((await loadReportData(api, { kind: 'table', name: 'Clients' })).rows).toHaveLength(4);
    expect(wheres).toEqual(['[Ville] = "Paris"', undefined]);
  });
  it('loadDocData and layoutSavedReport pass it on', async () => {
    wheres.length = 0;
    expect((await loadDocData(api, FACTURES_REPORT, undefined, undefined, '[Ville] = "Paris"')).rows).toEqual([['Durand', 'Paris']]);
    const env: LayoutEnv = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } };
    await layoutSavedReport(api, 'x', env, async () => null, undefined, undefined, '[Ville] = "Paris"');
    expect(wheres).toEqual(['[Ville] = "Paris"', '[Ville] = "Paris"']);
  });
});

describe('zoomFor', () => {
  it('zoom', () => {
    expect(zoomFor('actual', { w: 794, h: 1123 }, { w: 500, h: 500 })).toBe(1);
    expect(zoomFor('fitPage', { w: 794, h: 1123 }, { w: 794, h: 561.5 })).toBe(0.5);
    expect(zoomFor('fitPage', { w: 794, h: 1123 }, { w: 0, h: 0 })).toBeGreaterThan(0); // hidden viewport: never 0
  });
});

describe('layoutSavedReport', () => {
  const env: LayoutEnv = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } };
  const fake = (definition: unknown, parameters: SourceInfo['parameters'] = []) => ({
    objects: { get: async (_k: string, name: string) => ({ name, definition }) },
    sources: {
      describe: async (): Promise<SourceInfo> => ({ fields: FACTURES_FIELDS, updatable: false, parameters }),
      page: async (_: RecordSourceRef, r: SourcePageRequest): Promise<SourcePage> =>
        ({ rows: FACTURES_ROWS.slice(r.offset, r.offset + r.limit), rowids: [], total: FACTURES_ROWS.length }),
    },
  });

  const none = async () => { throw new Error('no parameter expected'); };
  it('reads the definition and the data, then lays the report out', async () => {
    const r = await layoutSavedReport(fake(FACTURES_REPORT), 'Factures par client', env, none);
    expect(r.pages).toHaveLength(3);
  });

  it("rejects with the failing step's code", async () => {
    await expect(layoutSavedReport(fake({ formatVersion: '1.0' }), 'x', env, none)).rejects.toThrow('bc:invalidDefinition');
    const gone = { ...fake(FACTURES_REPORT), objects: { get: async () => { throw new Error('bc:notFound'); } } };
    await expect(layoutSavedReport(gone, 'x', env, none)).rejects.toThrow('bc:notFound');
  });

  it('a source with parameters: asked first (C3), then `ready` (the progress box), then the data with the values', async () => {
    const steps: string[] = [];
    const api = fake(FACTURES_REPORT, P);
    const page = api.sources.page;
    api.sources.page = async (ref, r) => { steps.push(`page ${JSON.stringify(r.params)}`); return page(ref, r); };
    const r = await layoutSavedReport(api, 'x', env, async (ps) => { steps.push(`ask ${ps.map((x) => x.name)}`); return { 'Client voulu': 'Martin' }; }, undefined,
      () => steps.push('ready'));
    expect(steps).toEqual(['ask Client voulu', 'ready', 'page {"Client voulu":"Martin"}']);
    expect(r.pages.length).toBeGreaterThan(0);
  });
});

const P = [{ name: 'Client voulu', type: 'shortText' }] as unknown as SourceInfo['parameters'];
describe('report parameters (C3, promptParameters)', () => {
  const doc = { ...FACTURES_REPORT, recordSource: { kind: 'query' as const, name: 'Q' } };
  const withParams = (total: number) => {
    const api = fakeSources(total);
    return { ...api, sources: { ...api.sources, describe: async (): Promise<SourceInfo> => ({ fields: FIELDS, updatable: false, parameters: P }) } };
  };
  it('docParameters: the values typed; none asked without parameters or without a source', async () => {
    expect(await docParameters(withParams(0), doc, async () => ({ 'Client voulu': 'Martin' }))).toEqual({ 'Client voulu': 'Martin' });
    expect(await docParameters(fakeSources(0), doc, async () => { throw new Error('asked'); })).toBeUndefined();
    expect(await docParameters(fakeSources(0), { ...doc, recordSource: null }, async () => { throw new Error('asked'); })).toBeUndefined();
  });
  it('Cancel rejects with an AbortError, before any row is read', async () => {
    const api = withParams(10);
    const e = await docParameters(api, doc, async () => null).catch((x: unknown) => x);
    expect((e as Error).name).toBe('AbortError');
    expect(api.calls).toEqual([]);
  });
  it('the values reach every sources.page call', async () => {
    const api = withParams(2 * DATA_PAGE + 203);
    await loadDocData(api, doc, { 'Client voulu': 'Martin' });
    expect(api.calls.map((c) => [c.offset, c.params])).toEqual([0, DATA_PAGE, 2 * DATA_PAGE].map((o) => [o, { 'Client voulu': 'Martin' }]));
  });
});

describe('printRequestFor (final review I3)', () => {
  const page = { number: 1, bands: [] };
  const portrait = { width: 11906, height: 16838, pages: [page], issues: [] };
  it('the document, its name and its orientation', () => {
    const r = printRequestFor(portrait, 'Factures');
    expect(r).toMatchObject({ name: 'Factures', landscape: false }); expect(r.html.startsWith('<!doctype html>')).toBe(true);
    expect(printRequestFor({ ...portrait, width: 16838, height: 11906 }, 'x').landscape).toBe(true);
  });
  it('a document past the IPC cap rejects with tooLarge, before anything is sent', () => {
    expect(() => printRequestFor(portrait, 'Factures', 100)).toThrow(expect.objectContaining({ code: 'tooLarge' }));
    expect(MAX_PRINT_HTML_CHARS).toBe(64 * 1024 ** 2);
  });
});
