import { describe, expect, it, vi } from 'vitest';
import type { SourceInfo, SourcePageRequest } from '../../shared/record-source';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from '../../shared/report/fixtures/factures';
import type { LayoutEnv } from '../../shared/report/types';
import { flowKey, FLOW_ROWS, keptOutOfLayout, latestRun, layoutFlow, loadFlowData, type FlowApi, type FlowNotice } from './layout-flow';

function stub(rows: unknown[][], over: Partial<FlowApi['sources']> = {}, parameters: SourceInfo['parameters'] = []) {
  const reqs: SourcePageRequest[] = [];
  const api: FlowApi = { sources: {
    describe: async () => ({ fields: FACTURES_FIELDS, updatable: false, parameters }),
    page: async (_r, req) => { reqs.push(req); return { rows: rows.slice(req.offset, req.offset + req.limit) as never, rowids: [], total: rows.length }; },
    ...over,
  } };
  return { api, reqs };
}
const noAsk = async () => null;
const P = [{ name: 'Client voulu', type: 'shortText' }] as unknown as SourceInfo['parameters'];
const env: LayoutEnv = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } };
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('loadFlowData', () => {
  it('no source: noSource, still laid out (an empty flow)', async () => {
    const doc = { ...FACTURES_REPORT, recordSource: null };
    const s = await loadFlowData(doc, noAsk, stub([]).api);
    expect(s.notice).toBe('noSource');
    expect((await layoutFlow(doc, s, env, new AbortController().signal)).pages).toHaveLength(1);
  });
  it('an empty source', async () => expect((await loadFlowData(FACTURES_REPORT, noAsk, stub([]).api)).notice).toBe('empty'));
  it('describe rejecting is unreadable, never a rejection', async () =>
    expect((await loadFlowData(FACTURES_REPORT, noAsk, stub([], { describe: () => Promise.reject(new Error('x')) }).api)).notice).toBe('unreadable'));
  it('a 1000-row source loads exactly FLOW_ROWS rows and says truncated', async () => {
    const { api, reqs } = stub(Array.from({ length: 1000 }, (_, i) => FACTURES_ROWS[i % FACTURES_ROWS.length]!));
    const s = await loadFlowData(FACTURES_REPORT, noAsk, api);
    expect(s.data.rows).toHaveLength(FLOW_ROWS);
    expect(s.notice).toBe('truncated');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.limit).toBe(FLOW_ROWS + 1);
  });
  it('exactly FLOW_ROWS rows is not truncated', async () => {
    const s = await loadFlowData(FACTURES_REPORT, noAsk, stub(Array.from({ length: FLOW_ROWS }, () => FACTURES_ROWS[0]!)).api);
    expect(s.data.rows).toHaveLength(FLOW_ROWS);
    expect(s.notice).toBeNull();
  });
  it('a parameter source answered by ask loads, the answers sent', async () => {
    const { api, reqs } = stub(FACTURES_ROWS, {}, P);
    const s = await loadFlowData(FACTURES_REPORT, async () => ({ 'Client voulu': 'Martin' }), api);
    expect(s.notice).toBeNull();
    expect(reqs[0]!.params).toEqual({ 'Client voulu': 'Martin' });
  });
  it('a parameter prompt cancelled gives parameters, no row read', async () => {
    const { api, reqs } = stub(FACTURES_ROWS, {}, P);
    expect((await loadFlowData(FACTURES_REPORT, noAsk, api)).notice).toBe('parameters');
    expect(reqs).toEqual([]);
  });
  it('the source key follows the record source only', () => {
    expect(flowKey({ ...FACTURES_REPORT, sections: [] })).toBe(flowKey(FACTURES_REPORT));
    expect(flowKey({ ...FACTURES_REPORT, recordSource: { kind: 'query', name: 'Q' } })).not.toBe(flowKey(FACTURES_REPORT));
  });
});

describe('layoutFlow charts (F4)', () => {
  it('a chart control draws the data given; loadFlowData keeps the parameters asked', async () => {
    const doc = { ...FACTURES_REPORT, sections: [{ kind: 'reportHeader', height: 3000, props: {}, controls: [{ kind: 'chart', name: 'Graph', left: 0, top: 0, width: 4000, height: 2000, props: {} }] }] } as unknown as typeof FACTURES_REPORT;
    const s = await loadFlowData(doc, async () => ({ 'Client voulu': 'A' }), stub(FACTURES_ROWS, {}, P).api);
    expect(s.params).toEqual({ 'Client voulu': 'A' });
    const data = { columns: [{ role: 'category' as const, field: 'Client', name: 'Client' }, { role: 'value' as const, field: 'Montant', name: 'SumOfMontant' }], rows: [['A', 4]], truncated: false };
    const r = await layoutFlow(doc, s, env, new AbortController().signal, undefined, undefined, { Graph: data });
    const c = r.pages[0]!.bands.flatMap((b) => b.items).find((i) => i.kind === 'chart');
    expect(c).toMatchObject({ kind: 'chart', data });
  });
});

describe('layoutFlow', () => {
  it('one continuous page over the loaded rows; On Format / On Print hooks never invoked', async () => {
    const s = await loadFlowData(FACTURES_REPORT, noAsk, stub(FACTURES_ROWS).api);
    const hooks = { onFormat: vi.fn(async () => {}), onPrint: vi.fn(async () => {}), onBand: vi.fn() };
    const onPage = vi.fn();
    const r = await layoutFlow(FACTURES_REPORT, s, { ...env, hooks, onPage }, new AbortController().signal);
    expect(r.pages).toHaveLength(1);
    expect(hooks.onFormat).not.toHaveBeenCalled();
    expect(hooks.onPrint).not.toHaveBeenCalled();
    expect(hooks.onBand).not.toHaveBeenCalled();
    expect(onPage).not.toHaveBeenCalled();
  });
  it('a grouping change is laid out over the same rows: no reload needed for sorting or grouping', async () => {
    const s = await loadFlowData(FACTURES_REPORT, noAsk, stub(FACTURES_ROWS).api);
    const a = await layoutFlow(FACTURES_REPORT, s, env, new AbortController().signal);
    const ungrouped = { ...FACTURES_REPORT, props: { ...FACTURES_REPORT.props, grouping: [] } };
    expect(flowKey(ungrouped)).toBe(flowKey(FACTURES_REPORT));
    const b = await layoutFlow(ungrouped, s, env, new AbortController().signal);
    expect(b.pages).toHaveLength(1);
    expect(b.height).not.toBe(a.height);   // the group bands are gone, the same rows laid out
  });
  it('an aborted signal rejects with AbortError', async () => {
    const s = await loadFlowData(FACTURES_REPORT, noAsk, stub(FACTURES_ROWS).api);
    const ac = new AbortController(); ac.abort();
    await expect(layoutFlow(FACTURES_REPORT, s, env, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('latestRun', () => {
  it('two runs where the first is aborted: only the second result arrives', async () => {
    const run = latestRun(0);
    const done = vi.fn();
    let first!: AbortSignal, release!: (v: string) => void;
    run.schedule((signal) => { first = signal; return new Promise<string>((r) => { release = r; }); }, done);
    await tick();   // the first one has started
    run.schedule(async () => 'second', done);
    release('first');
    await tick();
    expect(first.aborted).toBe(true);
    expect(done.mock.calls).toEqual([['second']]);
  });
  it('debounced: runs scheduled within the delay start only the last', async () => {
    const run = latestRun(20);
    const job = vi.fn(async (_s: AbortSignal) => 'x');
    const done = vi.fn();
    run.schedule(job, done);
    run.schedule(job, done);
    run.schedule(job, done);
    await new Promise((r) => setTimeout(r, 40));
    expect(job).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('a layout that throws gives null (the notice unreadable), not a rejection', async () => {
    const run = latestRun(0);
    const done = vi.fn();
    run.schedule(() => { throw new Error('boom'); }, done);
    run.schedule(() => { throw new Error('boom'); }, done);
    await tick();
    expect(done.mock.calls).toEqual([[null]]);
  });
  it('cancel (unmount, leaving the mode) aborts the run and drops its result', async () => {
    const run = latestRun(0);
    const done = vi.fn();
    let signal!: AbortSignal, release!: (v: string) => void;
    run.schedule((s) => { signal = s; return new Promise<string>((r) => { release = r; }); }, done);
    await tick();
    run.cancel();
    release('late');
    await tick();
    expect(signal.aborted).toBe(true);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('keptOutOfLayout (leaving Layout view)', () => {
  const at = (notice: FlowNotice | null) => ({ key: 'k', source: { data: { fields: [], rows: [] }, notice } });
  it('a good read is kept (Design <-> Layout asks nothing again), empty and truncated included', () => {
    for (const n of [null, 'empty', 'truncated', 'noSource'] as const) { const s = at(n); expect(keptOutOfLayout(s), String(n)).toBe(s); }
  });
  it('a failed read (parameters cancelled, unreadable) is dropped: entering Layout again retries', () => {
    for (const n of ['parameters', 'unreadable'] as const) expect(keptOutOfLayout(at(n)), n).toBeNull();
    expect(keptOutOfLayout(null)).toBeNull();
  });
});
