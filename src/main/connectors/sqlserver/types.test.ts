import { describe, expect, it } from 'vitest';
import { msCi, msDecode, msField, msPtProps, msPtValue, msRemoteTable, type MsColumn } from './types';

// A column as the catalog reads it (sys.columns): `maxLength` in bytes (nvarchar: two per character).
const col = (c: Partial<MsColumn> & { type: string }): MsColumn =>
  ({ name: 'x', maxLength: 0, precision: 0, scale: 0, nullable: true, hasDefault: false, identity: false, computed: false, collation: null, ...c });

describe('msField (R5)', () => {
  it.each([
    ['bigint', {}, { type: 'number', numberSize: 'decimal', precision: 19, scale: 0 }],
    ['decimal', { precision: 38, scale: 10 }, { type: 'number', numberSize: 'decimal', precision: 28, scale: 6 }],
    ['decimal', { precision: 38, scale: 2 }, { type: 'number', numberSize: 'decimal', precision: 28, scale: 2 }],
    ['numeric', { precision: 10, scale: 2 }, { type: 'number', numberSize: 'decimal', precision: 10, scale: 2, msType: 'numeric(10,2)' }],
    ['money', {}, { type: 'currency' }], ['smallmoney', {}, { type: 'currency' }], ['tinyint', {}, { type: 'number', numberSize: 'byte' }],
    ['smallint', {}, { type: 'number', numberSize: 'integer' }], ['int', {}, { type: 'number', numberSize: 'longInteger' }],
    ['real', {}, { type: 'number', numberSize: 'single' }], ['float', {}, { type: 'number', numberSize: 'double' }], ['bit', {}, { type: 'yesNo' }],
    ['nvarchar', { maxLength: 160 }, { type: 'shortText', size: 80, msType: 'nvarchar(80)' }], ['nvarchar', { maxLength: -1 }, { type: 'longText', msType: 'nvarchar(max)' }],
    ['varchar', { maxLength: 300 }, { type: 'longText' }], ['varchar', { maxLength: 255 }, { type: 'shortText', size: 255 }], ['nchar', { maxLength: 512 }, { type: 'longText' }],
    ['char', { maxLength: 5 }, { type: 'shortText', size: 5, msType: 'char(5)' }], ['text', { maxLength: 16 }, { type: 'longText', msType: 'text' }], ['ntext', {}, { type: 'longText' }],
    ['uniqueidentifier', {}, { type: 'shortText', size: 36 }], ['datetime2', { scale: 7 }, { type: 'dateTime', msType: 'datetime2(7)' }], ['datetimeoffset', { scale: 7 }, { type: 'shortText', size: 34, msType: 'datetimeoffset(7)' }],
    ['date', {}, { type: 'dateTime' }], ['smalldatetime', {}, { type: 'dateTime' }], ['datetime', {}, { type: 'dateTime' }], ['time', { scale: 3 }, { type: 'dateTime', msType: 'time(3)' }],
  ])('%s %o maps', (type, o, props) => expect(msField(col({ type, ...o }))?.props).toMatchObject(props));

  it.each(['xml', 'varbinary', 'binary', 'image', 'sql_variant', 'hierarchyid', 'geography', 'geometry', 'timestamp', ''])('%s is skipped', (type) =>
    expect(msField(col({ type }))).toBeNull());

  it('identity and computed are never written; collation CI_AS read', () => {
    expect(msField(col({ type: 'int', identity: true }))?.props).toMatchObject({ type: 'autoNumber', msComputed: true });
    expect(msField(col({ type: 'tinyint', identity: true }))?.props).toMatchObject({ type: 'number', numberSize: 'byte', msComputed: true });
    expect(msField(col({ type: 'int', computed: true }))?.props).toMatchObject({ type: 'number', msComputed: true });
    expect(msField(col({ type: 'int' }))?.props).not.toHaveProperty('msComputed');
    expect(msField(col({ type: 'nvarchar', maxLength: 20, collation: 'French_CI_AS' }))?.props).toMatchObject({ msCi: true, msCollation: 'French_CI_AS' });
    expect(msField(col({ type: 'nvarchar', maxLength: 20, collation: 'Latin1_General_100_CS_AS' }))?.props.msCi).toBe(false);
    expect(msField(col({ type: 'int' }))?.props).not.toHaveProperty('msCi');
    expect(msField(col({ type: 'int' }))?.props).not.toHaveProperty('msCollation');
  });
  it('Required: NOT NULL without a default, an identity or a computation', () => {
    expect(msField(col({ type: 'int', nullable: false }))?.props.required).toBe(true);
    for (const o of [{ hasDefault: true }, { identity: true }, { computed: true }]) expect(msField(col({ type: 'int', nullable: false, ...o }))?.props.required).toBe(false);
  });
  it('a temporal table period column (the catalog reads it as computed): a Date/Time never written, never Required', () => { // review Important 1
    expect(msField(col({ type: 'datetime2', scale: 7, nullable: false, computed: true }))?.props).toMatchObject({ type: 'dateTime', required: false, msComputed: true });
  });
  it('msCi: case-insensitive and accent-sensitive collations only', () => {
    for (const c of ['French_CI_AS', 'SQL_Latin1_General_CP1_CI_AS', 'Latin1_General_100_CI_AS_SC_UTF8', 'Japanese_CI_AS_KS_WS']) expect(msCi(c)).toBe(true);
    for (const c of ['Latin1_General_100_CS_AS', 'Latin1_General_100_BIN2', 'French_CI_AI', 'Latin1_General_100_CS_AS_SC_UTF8', null]) expect(msCi(c)).toBe(false);
  });
});

describe('msDecode (R6)', () => {
  const big = msField(col({ type: 'bigint' }))!;
  const ts = msField(col({ type: 'datetime2', scale: 7 }))!;
  const yn = msField(col({ type: 'bit' }))!;
  const dec = (c: Partial<MsColumn> & { type: string }, raw: unknown) => msDecode(msField(col(c))!, raw);

  it('decodes exact digits, drops fractions, Yes/No 1/0', () => {   // Review Focus 3
    expect(msDecode(big, '9007199254740993')).toBe('9007199254740993');
    expect(msDecode(ts, '2026-10-31 12:34:56.7891234')).toBe('2026-10-31 12:34:56'); expect(msDecode(yn, true)).toBe(1);
    expect(msDecode(yn, false)).toBe(0); expect(msDecode(yn, -1)).toBe(1); expect(msDecode(yn, 0)).toBe(0); expect(msDecode(yn, null)).toBeNull();
  });
  it('dates before 0100 Null; a time on 1899-12-30', () => {
    expect(msDecode(ts, '0099-12-31 23:59:59.0000000')).toBeNull(); expect(msDecode(ts, '0100-01-01 00:00:00.0000000')).toBe('0100-01-01 00:00:00');
    expect(dec({ type: 'time', scale: 7 }, '1899-12-30 08:30:00.0000000')).toBe('1899-12-30 08:30:00');
    expect(msDecode(ts, 'garbage')).toBeNull();
  });
  it('numbers: decimals at their scale, money exact to 4 places, Single at 7 digits', () => {
    expect(dec({ type: 'decimal', precision: 38, scale: 10 }, '12345678901234567890.1234567890')).toBe('12345678901234567890.123457');
    expect(dec({ type: 'decimal', precision: 10, scale: 2 }, '12.5000000000')).toBe('12.50');
    expect(dec({ type: 'money' }, '922337203685.4775')).toBe(922337203685.4775); expect(dec({ type: 'money' }, '1.2300')).toBe(1.23);
    expect(dec({ type: 'real' }, 0.10000000149011612)).toBe(0.1); expect(dec({ type: 'int' }, 42)).toBe(42); expect(dec({ type: 'float' }, 0.5)).toBe(0.5);
    expect(dec({ type: 'decimal', precision: 5, scale: 0 }, 'x')).toBeNull();
  });
  it('text as stored (char padding kept)', () => {
    expect(dec({ type: 'char', maxLength: 5 }, 'ab   ')).toBe('ab   ');
    expect(dec({ type: 'datetimeoffset', scale: 7 }, '2026-10-31 12:34:56.1234567 +01:00')).toBe('2026-10-31 12:34:56.1234567 +01:00');
  });
});

describe('msRemoteTable (R14, R11)', () => {
  const cols = [col({ name: 'id', type: 'int', identity: true, nullable: false }), col({ name: 'Nom', type: 'nvarchar', maxLength: 160, collation: 'French_CI_AS' })];
  it('link names and the rowversion column', () => {
    const t = msRemoteTable('dbo', 'Clients', [...cols, col({ name: 'rv', type: 'timestamp' })], ['id']);
    expect(t).toMatchObject({ name: 'Clients', remote: 'Clients', schema: 'dbo', version: 'rv', skipped: [], key: ['id'] }); expect(t.design.fields.map((f) => f.name)).not.toContain('rv');
    expect(msRemoteTable('compta', 'Factures', cols, []).name).toBe('compta_Factures');
    expect(msRemoteTable('dbo', 'Clients', cols, ['id'])).not.toHaveProperty('version');
    expect(msRemoteTable('dbo', 'bc_x', cols, []).unsupported).toBe('reservedName');
  });
  it('an AutoNumber is the sole primary key, else its integer type, still never written; a key with a skipped column is none', () => {
    expect(msRemoteTable('dbo', 'T', cols, ['id']).design.fields[0]!.props).toMatchObject({ type: 'autoNumber', primaryKey: true, msComputed: true });
    expect(msRemoteTable('dbo', 'T', cols, []).design.fields[0]!.props).toMatchObject({ type: 'number', numberSize: 'longInteger', primaryKey: false, msComputed: true });
    const big = [col({ name: 'n', type: 'bigint', identity: true }), ...cols.slice(1)];
    expect(msRemoteTable('dbo', 'T', big, ['n', 'Nom']).design.fields[0]!.props).toMatchObject({ type: 'number', numberSize: 'decimal', precision: 19, scale: 0, primaryKey: true, msComputed: true });
    const t = msRemoteTable('dbo', 'T', [...cols, col({ name: 'b', type: 'varbinary', maxLength: 16 })], ['id', 'b']);
    expect(t).toMatchObject({ key: [], skipped: ['b'] });
    expect(t.design.fields.every((f) => !f.props.primaryKey)).toBe(true);
  });
});

describe('pass-through results (R13)', () => {
  it('result columns: the link mapping, every other type as Long Text', () => {
    expect(msPtProps('IntN', 10, 0, 4)).toMatchObject({ type: 'number', numberSize: 'longInteger', required: false });
    expect(msPtProps('NVarChar', 0, 0, 160)).toMatchObject({ type: 'shortText', size: 80 });
    for (const t of ['Xml', 'VarBinary', 'UDT', 'Variant']) expect(msPtProps(t, 0, 0, 0).type).toBe('longText');
    expect(msPtProps('IntN', 0, 0, 8)).toMatchObject({ type: 'number', numberSize: 'decimal', precision: 19, scale: 0 }); // bigint
    expect(msPtProps('IntN', 0, 0, 1)).toMatchObject({ numberSize: 'byte' }); expect(msPtProps('FloatN', 0, 0, 4)).toMatchObject({ numberSize: 'single' });
    expect(msPtProps('MoneyN', 19, 4, 8).type).toBe('currency'); expect(msPtProps('BitN', 0, 0, 1).type).toBe('yesNo');
    expect(msPtProps('DecimalN', 38, 10, 17)).toMatchObject({ numberSize: 'decimal', precision: 28, scale: 6 });
    expect(msPtProps('NVarChar', 0, 0, 0xffff).type).toBe('longText'); // nvarchar(max)
    for (const t of ['Date', 'DateTime2', 'DateTimeN', 'Time', 'SmallDateTime']) expect(msPtProps(t, 0, 7, 8).type).toBe('dateTime');
    expect(msPtProps('DateTimeOffset', 0, 7, 10)).toMatchObject({ type: 'shortText', size: 34 });
    const p = msPtProps('NVarChar', 0, 0, 20);
    for (const k of ['msType', 'msCi', 'msCollation', 'msComputed']) expect(p).not.toHaveProperty(k);
    expect(p).toMatchObject({ required: false, indexed: 'no', primaryKey: false });
  });
  it('values as tedious parses them, as msDecode reads them: dates by their UTC parts, decimals as digits, binaries as 0x', () => {
    const at = (type: string, scale: number, raw: unknown) => msDecode({ name: 'c', props: msPtProps(type, 38, scale, 8) }, msPtValue(raw, type, scale));
    const d = new Date(Date.UTC(2026, 9, 31, 23, 30, 5, 120));
    expect(at('DateTime2', 7, d)).toBe('2026-10-31 23:30:05');
    expect(at('Time', 7, new Date(Date.UTC(1970, 0, 1, 8, 30, 0)))).toBe('1899-12-30 08:30:00');
    expect(at('DateTimeOffset', 7, d)).toBe('2026-10-31 23:30:05.120 +00:00');
    expect(at('Date', 0, new Date('0099-12-31T00:00:00Z'))).toBeNull(); // before 0100
    expect(at('DecimalN', 2, 12.5)).toBe('12.50'); expect(at('DecimalN', 10, 1e-7)).toBe('0.000000'); // decimal(28, 6)
    expect(at('NumericN', 0, 1e25)).toBe('10000000000000000905969664'); // beyond a double's digits: rounded (documented)
    expect(at('IntN', 0, '9007199254740993')).toBe('9007199254740993'); // bigint: tedious's digits
    expect(at('VarBinary', 0, Buffer.from([0, 0xab]))).toBe('0x00AB');
    expect(at('Variant', 0, d)).toBe('2026-10-31 23:30:05'); expect(at('Variant', 0, 1.5)).toBe('1.5');
    expect(msPtValue(null, 'DateTime2', 7)).toBeNull();
  });
});
