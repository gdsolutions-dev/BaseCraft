import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import type { SourceField, SourceInfo, SourcePageRequest } from '../../shared/record-source';
import { LIVE_ROWS, liveContent, loadLive, type LiveApi, type LiveData } from './live-records';

const ctl = (kind: ControlDef['kind'], src: string, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind, name: `c${src}`, left: 0, top: 0, width: 1000, height: 300, props: { ControlSource: src, ...props } });
const sf = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) as FieldProps });
const info: SourceInfo = { fields: [sf('Nom', 'shortText'), sf('Actif', 'yesNo'), sf('Prix', 'number')], updatable: true, keyTable: 'T', parameters: [] };
const data: LiveData = { info, rows: [['dupont', -1, null]], notice: null };
const ctx = { locale: 'fr-FR', lang: 'fr' as const };

describe('liveContent', () => {
  it('a text box shows the bound value formatted by its Format', () =>
    expect(liveContent(ctl('textBox', 'Nom', { Format: '>' }), data, 0, ctx)).toEqual({ kind: 'text', text: 'DUPONT' }));
  it('a check box gives its value', () => expect(liveContent(ctl('checkBox', 'Actif'), data, 0, ctx)).toEqual({ kind: 'check', checked: true }));
  it('a Null value gives empty text', () => expect(liveContent(ctl('textBox', 'Prix'), data, 0, ctx)).toEqual({ kind: 'text', text: '' }));
  it('an unknown field gives empty text, no throw', () => expect(liveContent(ctl('textBox', 'Absent'), data, 0, ctx)).toEqual({ kind: 'text', text: '' }));
  it('a row past the data gives empty text', () => expect(liveContent(ctl('comboBox', 'Nom'), data, 3, ctx)).toEqual({ kind: 'text', text: '' }));
  it('a calculated control keeps its Design preview', () => expect(liveContent(ctl('textBox', '=[Prix]*2'), data, 0, ctx)).toEqual({ kind: 'placeholder' }));
  it('a date follows the four-digit year option (O2 R11)', () => {
    const d: LiveData = { info: { fields: [sf('Le', 'dateTime')], updatable: true, keyTable: 'T', parameters: [] }, rows: [['2026-03-05 00:00:00']], notice: null };
    const c = ctl('textBox', 'Le', { Format: 'dd/mm/yy' });
    expect(liveContent(c, d, 0, ctx)).toEqual({ kind: 'text', text: '05/03/26' });
    expect(liveContent(c, d, 0, { ...ctx, fourDigitYear: true })).toEqual({ kind: 'text', text: '05/03/2026' });
  });
  it('a subform is a placeholder', () => expect(liveContent(ctl('subform', ''), data, 0, ctx)).toEqual({ kind: 'placeholder' }));
});

function stub(rows: unknown[][], over: Partial<LiveApi['sources']> = {}, params: SourceInfo['parameters'] = []) {
  const reqs: SourcePageRequest[] = [];
  const api: LiveApi = { sources: {
    describe: async () => ({ ...info, parameters: params }),
    page: async (_r, req) => { reqs.push(req); const r = rows.slice(req.offset, req.offset + req.limit) as never; return { rows: r, rowids: [], total: rows.length }; },
    ...over,
  } };
  return { api, reqs };
}
const T = { kind: 'table' as const, name: 'T' };
const noAsk = async () => null;

describe('loadLive', () => {
  it('no source', async () => expect((await loadLive(null, noAsk, stub([]).api)).notice).toBe('noSource'));
  it('an empty page', async () => expect((await loadLive(T, noAsk, stub([]).api)).notice).toBe('empty'));
  it('describe rejecting is unreadable', async () =>
    expect((await loadLive(T, noAsk, stub([], { describe: () => Promise.reject(new Error('x')) }).api)).notice).toBe('unreadable'));
  it('reads LIVE_ROWS rows of a 1000-row source, the limit in the request', async () => {
    const { api, reqs } = stub(Array.from({ length: 1000 }, (_, i) => [i]));
    const d = await loadLive(T, noAsk, api);
    expect(d.rows).toHaveLength(LIVE_ROWS);
    expect(reqs[0]!.limit).toBe(LIVE_ROWS);
    expect(d.notice).toBeNull();
  });
  it('a parameterized source answered by ask loads, the answers sent', async () => {
    const { api, reqs } = stub([['a']], {}, [{ name: 'Ville', type: 'shortText' }]);
    const d = await loadLive(T, async () => ({ Ville: 'Lyon' }), api);
    expect(d.notice).toBeNull();
    expect(reqs[0]!.params).toEqual({ Ville: 'Lyon' });
  });
  it('a parameterized source not answered', async () =>
    expect((await loadLive(T, noAsk, stub([['a']], {}, [{ name: 'Ville', type: 'shortText' }]).api)).notice).toBe('parameters'));
});
