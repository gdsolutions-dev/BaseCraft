import { describe, expect, it } from 'vitest';
import { pgParams, pgKey, pgLabel } from './params';
import { pgDecode, pgField, ptProps, remoteTable, type PgColumn } from './types';
import { prepareWrite } from '../../db/write-layer';
import { localeInfo } from '../../../shared/locale-format';

// A catalog row as the connector reads it: `type` is format_type's text; base and typmod derived from it as the server gives them.
const BASES: Record<string, string> = {
  smallint: 'int2', integer: 'int4', bigint: 'int8', real: 'float4', 'double precision': 'float8', boolean: 'bool', numeric: 'numeric',
  'character varying': 'varchar', character: 'bpchar', text: 'text', citext: 'citext', uuid: 'uuid', json: 'json', jsonb: 'jsonb',
  date: 'date', 'timestamp without time zone': 'timestamp', 'timestamp with time zone': 'timestamptz', 'time without time zone': 'time',
  'time with time zone': 'timetz', money: 'money', interval: 'interval', bytea: 'bytea', xml: 'xml', point: 'point', int4range: 'int4range',
  humeur: 'enum',
};
function col(c: Partial<PgColumn> & { type: string }): PgColumn {
  let base = 'array';
  let typmod = -1;
  if (!c.type.endsWith('[]')) {
    const m = /^([a-z0-9 ]+?)(?:\((\d+)(?:,(\d+))?\))?( with(?:out)? time zone)?$/.exec(c.type)!;
    base = BASES[m[1]! + (m[4] ?? '')]!;
    if (m[2] !== undefined) typmod = base === 'numeric' ? ((Number(m[2]) << 16) | Number(m[3] ?? 0)) + 4 : base.startsWith('time') ? Number(m[2]) : Number(m[2]) + 4;
  }
  return { name: 'x', base, typmod, notNull: false, hasDefault: false, identity: false, ...c };
}

describe('params', () => {
  it('normalizes: defaults filled, other keys dropped, invalid values refused', () => {
    expect(pgParams({ host: 'DB.example', database: 'ventes', user: 'ana', password: 'x' }))
      .toEqual({ host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 });
    for (const bad of [null, [], { host: '', database: 'd', user: 'u' }, { host: 'h', database: 'd', user: 'u', port: 0 }, { host: 'h', database: 'd', user: 'u', port: 65536 },
      { host: 'h', database: 'd'.repeat(64), user: 'u' }, { host: 'h', database: 'd', user: 'u', tls: 'prefer' }, { host: 'h', database: 'd', user: 'u', timeout: 3601 },
      { host: 'h', database: 'd', user: 'u', timeout: 1.5 },
      ...['h:5432/x', 'h?x', 'h#x', 'h x', ' h', 'h\t', 'h\u0000', 'h\u0085'].map((h) => ({ host: h, database: 'd', user: 'u' }))]) expect(() => pgParams(bad)).toThrow('bc:invalidArgument');
  });
  it('key: host lower-cased, TLS mode, never the user; label as typed', () => {
    const p = pgParams({ host: 'DB.example', port: 5433, database: 'Ventes', user: 'ana', tls: 'require' });
    expect(pgKey(p)).toBe('postgresql://db.example:5433/Ventes?tls=require');
    expect(pgKey({ ...p, user: 'bob' })).toBe(pgKey(p));
    expect(pgLabel(p)).toBe('db.example:5433/Ventes');
    expect(pgParams({ host: 'fe80::1%eth0', database: 'd', user: 'u' }).host).toBe('fe80::1%eth0'); // IPv6, unbracketed
  });
});

describe('pgField (R13)', () => {
  it.each([
    ['bigint', { type: 'number', numberSize: 'decimal', precision: 19, scale: 0 }],
    ['numeric(30,10)', { type: 'number', numberSize: 'decimal', precision: 28, scale: 6 }],
    ['character varying(80)', { type: 'shortText', size: 80 }], ['character varying(300)', { type: 'longText' }],
    ['timestamp(6) without time zone', { type: 'dateTime' }], ['uuid', { type: 'shortText', size: 36 }],
    ['smallint', { type: 'number', numberSize: 'integer' }], ['integer', { type: 'number', numberSize: 'longInteger' }],
    ['real', { type: 'number', numberSize: 'single' }], ['double precision', { type: 'number', numberSize: 'double' }],
    ['numeric(10,2)', { type: 'number', numberSize: 'decimal', precision: 10, scale: 2 }], ['numeric', { type: 'number', numberSize: 'decimal', precision: 28, scale: 6 }],
    ['boolean', { type: 'yesNo' }], ['character(5)', { type: 'shortText', size: 5 }], ['character varying(255)', { type: 'shortText', size: 255 }],
    ['character varying', { type: 'longText' }], ['text', { type: 'longText' }], ['citext', { type: 'longText' }],
  ])('%s maps', (type, props) => expect(pgField(col({ type }))?.props).toMatchObject(props));

  it.each([
    ['date', 'timestamp'], ['timestamp with time zone', 'timestamp'], ['time without time zone', 'time'],
    ['humeur', 'text'], ['json', 'text'], ['jsonb', 'text'], ['uuid', 'text'],
    ['timestamp without time zone', undefined], ['text', undefined], ['integer', undefined],
  ])('%s is presented to the generator as pgCast %s', (type, cast) => expect(pgField(col({ type }))?.props.pgCast).toBe(cast));

  it.each(['money', 'interval', 'bytea', 'integer[]', 'time with time zone', 'xml', 'point', 'int4range', 'unknown'])('%s is skipped', (type) =>
    expect(pgField(type === 'unknown' ? col({ type: 'text', base: '' }) : col({ type }))).toBeNull());

  it('identity is AutoNumber; NOT NULL with a default is not Required', () => {
    expect(pgField(col({ type: 'integer', identity: true }))?.props.type).toBe('autoNumber');
    expect(pgField(col({ type: 'bigint', identity: true }))?.props.type).toBe('autoNumber');
    expect(pgField(col({ type: 'text', notNull: true, hasDefault: true }))?.props.required).toBe(false);
    expect(pgField(col({ type: 'text', notNull: true }))?.props.required).toBe(true);
    expect(pgField(col({ type: 'integer', notNull: true, identity: true }))?.props.required).toBe(false);
  });
});

describe('pgDecode', () => {
  const big = pgField(col({ type: 'bigint' }))!;
  const ts = pgField(col({ type: 'timestamp(6) without time zone' }))!;
  const yn = pgField(col({ type: 'boolean' }))!;
  const tm = pgField(col({ type: 'time without time zone' }))!;
  const dec = (type: string, raw: unknown) => pgDecode(pgField(col({ type }))!, raw);

  it('decodes exact digits, microseconds dropped, booleans 1/0, out-of-range dates Null', () => {   // Review Focus 3
    expect(pgDecode(big, '9007199254740993')).toBe('9007199254740993');
    expect(pgDecode(ts, '2026-10-30 12:34:56.789123')).toBe('2026-10-30 12:34:56');
    expect(pgDecode(ts, '0042-01-01 00:00:00')).toBeNull(); expect(pgDecode(ts, 'infinity')).toBeNull();
    expect(pgDecode(yn, true)).toBe(1); expect(pgDecode(tm, '08:30:00')).toBe('1899-12-30 08:30:00');
  });
  it('dates: date, timestamptz in the session zone, BC and year 10000 Null, a time presented on 1899-12-30', () => {
    expect(dec('date', '2026-10-30')).toBe('2026-10-30 00:00:00');
    expect(dec('timestamp with time zone', '2026-10-30 12:34:56.5+05:30')).toBe('2026-10-30 12:34:56');
    expect(dec('timestamp with time zone', '2026-10-30 12:34:56-08')).toBe('2026-10-30 12:34:56');
    expect(dec('date', '2026-10-30 BC')).toBeNull(); expect(dec('timestamp without time zone', '0042-01-01 00:00:00 BC')).toBeNull();
    expect(dec('date', '10000-01-01')).toBeNull(); expect(dec('date', '-infinity')).toBeNull();
    expect(dec('date', '0100-01-01')).toBe('0100-01-01 00:00:00'); expect(dec('date', '0099-12-31')).toBeNull();
    expect(dec('time without time zone', '1899-12-30 08:30:00')).toBe('1899-12-30 08:30:00'); // through pgCast 'time'
    expect(dec('time without time zone', '24:00:00')).toBeNull();
    const key = remoteTable('public', 'T', [col({ name: 't', type: 'time without time zone' })], ['t']).design.fields[0]!; // review minor 1
    expect(key.props.pgCast).toBeUndefined();
    expect(pgDecode(key, '08:30:00')).toBe('1899-12-30 08:30:00'); // a key is read as stored
  });
  it('numbers: decimals rounded to their scale, NaN and infinities Null, Single at 7 digits, Yes/No any non-zero', () => {
    expect(dec('numeric', '1.23456789')).toBe('1.234568'); expect(dec('numeric(10,2)', '12.50')).toBe('12.50');
    expect(dec('numeric', 'NaN')).toBeNull(); expect(dec('numeric', 'Infinity')).toBeNull(); expect(dec('double precision', Infinity)).toBeNull();
    expect(dec('real', 0.10000000149011612)).toBe(0.1); expect(dec('integer', 42)).toBe(42); expect(dec('integer', '42')).toBe(42);
    expect(dec('boolean', false)).toBe(0); expect(dec('boolean', -1)).toBe(1); expect(dec('boolean', 0)).toBe(0); expect(dec('boolean', null)).toBeNull();
    for (const [raw, v] of [['t', 1], ['true', 1], ['f', 0], ['false', 0], ['F', 0], ['0', 0], ['-1', 1], ['', 0]] as const) expect(dec('boolean', raw)).toBe(v); // review minor 8
    expect(pgDecode(pgField(col({ type: 'bigint', identity: true }))!, '12')).toBe(12);
  });
  it('text as stored (bpchar padding kept)', () => {
    expect(dec('character(5)', 'ab   ')).toBe('ab   '); expect(dec('uuid', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

describe('remoteTable (R6)', () => {
  const cols = [col({ name: 'id', type: 'integer', identity: true, notNull: true }), col({ name: 'Nom', type: 'text' })];
  it('link names: public bare, other schemas prefixed, invalid names unsupported', () => {
    expect(remoteTable('public', 'Clients', cols, ['id']).name).toBe('Clients');
    expect(remoteTable('compta', 'Factures', cols, []).name).toBe('compta_Factures');
    expect(remoteTable('public', 'a.b', cols, []).unsupported).toBeDefined();
    expect(remoteTable('public', 'bc_x', cols, []).unsupported).toBe('reservedName');
    expect(remoteTable('public', 'T', [col({ name: 'oid', type: 'text' })], []).unsupported).toBe('reservedFieldName');
    expect(remoteTable('public', 'T', [col({ name: 'b', type: 'bytea' })], []).unsupported).toBe('noFields');
  });
  it('remote, schema, key and design; the key columns marked and never cast', () => {
    const t = remoteTable('compta', 'Factures', [col({ name: 'n', type: 'uuid' }), col({ name: 'd', type: 'date' }), col({ name: 'b', type: 'bytea' })], ['n']);
    expect(t).toMatchObject({ name: 'compta_Factures', remote: 'Factures', schema: 'compta', key: ['n'], skipped: ['b'] });
    expect(t.unsupported).toBeUndefined();
    expect(t.design.name).toBe('compta_Factures');
    expect(t.design.fields.map((x) => [x.name, x.props.primaryKey, x.props.pgCast])).toEqual([['n', true, undefined], ['d', false, 'timestamp']]);
  });
  it('an AutoNumber is the sole primary key, else a Number; a key with a skipped column is none', () => {
    expect(remoteTable('public', 'T', cols, ['id']).design.fields[0]!.props).toMatchObject({ type: 'autoNumber', primaryKey: true });
    expect(remoteTable('public', 'T', cols, []).design.fields[0]!.props).toMatchObject({ type: 'number', numberSize: 'longInteger', primaryKey: false });
    expect(remoteTable('public', 'T', cols, ['id', 'Nom']).design.fields[0]!.props.type).toBe('number');
    const two = [...cols, col({ name: 'big', type: 'bigint', identity: true })];
    expect(remoteTable('public', 'T', two, ['id']).design.fields.map((x) => x.props.type)).toEqual(['autoNumber', 'longText', 'number']);
    expect(remoteTable('public', 'T', [...cols, col({ name: 'b', type: 'bytea' })], ['id', 'b']).key).toEqual([]);
    expect(remoteTable('public', 'T', cols, ['id']).unsupported).toBeUndefined();
  });
  it('a key the server fills (a default) may be left out of an insert; a key without one stays Required', async () => { // C5 Task 5
    const t = remoteTable('public', 'T', [col({ name: 'id', type: 'uuid', notNull: true, hasDefault: true }), col({ name: 'k', type: 'text', notNull: true }),
      col({ name: 'x', type: 'integer' })], ['id', 'k']);
    expect(t.design.fields.map((x) => [x.name, x.props.primaryKey, x.props.external, x.props.required])).toEqual([['id', true, true, false], ['k', true, true, true], ['x', false, undefined, false]]);
    const p = await prepareWrite('insert', t.design, { x: '1' }, localeInfo('fr-FR'), () => new Date(0), {});
    expect(p).toEqual({ ok: false, errors: [{ field: 'k', code: 'required' }] }); // not id
    expect(await prepareWrite('insert', t.design, { k: 'a' }, localeInfo('fr-FR'), () => new Date(0), {})).toMatchObject({ ok: true, values: { k: 'a' } });
  });
});

describe('pass-through result columns (C6 R6)', () => {
  it('the link mapping, every other type as Long Text', () => {
    expect(ptProps(23, -1)).toMatchObject({ type: 'number', numberSize: 'longInteger', required: false });
    expect(ptProps(1043, 84)).toMatchObject({ type: 'shortText', size: 80 });
    expect(ptProps(1700, -1)).toMatchObject({ type: 'number', numberSize: 'decimal', precision: 28, scale: 6 });
    expect(ptProps(2950, -1)).not.toHaveProperty('pgCast');
    for (const oid of [790 /* money */, 1186 /* interval */, 1007 /* int4[] */, 17 /* bytea */, 19 /* name */, 99999 /* an enum */]) expect(ptProps(oid, -1).type).toBe('longText');
  });
});
