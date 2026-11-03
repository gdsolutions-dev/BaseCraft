import { expect, it } from 'vitest';
import { defaultProps, type FieldProps, type FieldType } from '../../../shared/field-types';
import type { Literal, ServerField, ServerForeignKey, ServerTable } from '../../migrate/plan';
import { msCascadeDowngrades, msColumnType, msCreateTable, msFinishTable, msForeignKey, msInsertRows, msLiteral, msUnfiltered, msVersionColumn } from './ddl';

const props = (type: FieldType, o: Partial<FieldProps> = {}): FieldProps => ({ ...defaultProps(type), ...o });
const field = (name: string, type: FieldType, o: Partial<FieldProps> & { default?: Literal } = {}): ServerField => {
  const { default: d, ...p } = o;
  return { name, props: props(type, p), ...(d && { default: d }) };
};
const auto = (name: string) => field(name, 'autoNumber');
const short = (name: string, size: number, o: Partial<FieldProps> & { default?: Literal } = {}) => field(name, 'shortText', { size, ...o });
const yesNo = (name: string) => field(name, 'yesNo');
const table = (name: string, fields: ServerField[], o: Partial<ServerTable> = {}): ServerTable =>
  ({ name, schema: 'dbo', fields, key: fields.filter((x) => x.props.primaryKey).map((x) => x.name), indexes: [], rows: 0, ...o });

it('R4 on SQL Server', () => {
  expect(msColumnType(props('currency'))).toBe('money');
  expect(msColumnType(props('number', { numberSize: 'byte' }))).toBe('tinyint');
  expect(msColumnType(props('dateTime'))).toBe('datetime2(0)');
  expect(msColumnType(props('longText'))).toBe('nvarchar(max)');
  expect(msColumnType(props('hyperlink'))).toBe('nvarchar(max)');
  expect(msColumnType(props('autoNumber'))).toBe('int IDENTITY(1,1)');
  expect(msColumnType(props('shortText', { size: 40 }))).toBe('nvarchar(40)');
  expect(msColumnType(props('number', { numberSize: 'integer' }))).toBe('smallint');
  expect(msColumnType(props('number'))).toBe('int');
  expect(msColumnType(props('number', { numberSize: 'single' }))).toBe('real');
  expect(msColumnType(props('number', { numberSize: 'double' }))).toBe('float');
  expect(msColumnType(props('number', { numberSize: 'decimal', precision: 28, scale: 10 }))).toBe('decimal(28,10)');
  expect(msColumnType(props('yesNo'))).toBe('bit');
});

it('a size, precision or scale outside its integer range never reaches the type text', () => {
  for (const o of [{ size: '10); DROP TABLE x; --' }, { size: 0 }, { size: 256 }, { size: 1.5 }] as unknown as Partial<FieldProps>[])
    expect(() => msColumnType(props('shortText', o))).toThrow('bc:invalidArgument');
  const dec = (precision: unknown, scale: unknown) => () => msColumnType(props('number', { numberSize: 'decimal', precision, scale } as Partial<FieldProps>));
  expect(dec(2.5, 0)).toThrow('bc:invalidArgument');
  expect(dec(29, 0)).toThrow('bc:invalidArgument');
  expect(dec(5, 6)).toThrow('bc:invalidArgument');
  expect(dec(5, '1); DROP TABLE x; --')).toThrow('bc:invalidArgument');
  expect(dec(28, 28)()).toBe('decimal(28,28)');
  expect(() => msColumnType(props('number', { numberSize: 'x' } as unknown as Partial<FieldProps>))).toThrow('bc:invalidArgument');
});

it('literal defaults: N strings with quotes doubled, ] and non-Latin text as is, a backslash before a line break kept; numbers, dates, Yes/No', () => {
  expect(msLiteral({ k: 'str', v: "O'Brien" })).toBe("N'O''Brien'");
  expect(msLiteral({ k: 'str', v: '東京 "été" ]x[ C:\\y' })).toBe('N\'東京 "été" ]x[ C:\\y\'');
  // T-SQL drops a backslash followed by a line break (line continuation): every line break goes as NCHAR
  expect(msLiteral({ k: 'str', v: 'a\\\r\nb' })).toBe("(N'a\\' + NCHAR(13) + NCHAR(10) + N'b')");
  expect(msLiteral({ k: 'date', v: '2026-01-01 00:00:00' })).toBe("'2026-01-01T00:00:00'");
  expect(msLiteral({ k: 'bool', v: true })).toBe('1');
  expect(msLiteral({ k: 'bool', v: false })).toBe('0');
  expect(msLiteral({ k: 'num', v: '-2.5' })).toBe('-2.5');
  expect(() => msLiteral({ k: 'num', v: '1; DROP TABLE x' })).toThrow('bc:invalidArgument');
  expect(() => msLiteral({ k: 'date', v: "2026-01-01' OR '" })).toThrow('bc:invalidArgument');
});

it('CREATE TABLE adds the rowversion column and quotes ] in names', () => {
  expect(msCreateTable(table('Cl]i', [auto('N°'), yesNo('Ok')]), 'bc_rowversion'))
    .toBe('CREATE TABLE [dbo].[Cl]]i] ([N°] int IDENTITY(1,1) NOT NULL, [Ok] bit NOT NULL DEFAULT 0, [bc_rowversion] rowversion, PRIMARY KEY ([N°]))');
  // NOT NULL for Required and key fields, a literal default, a composite key in design order; no key: no PRIMARY KEY
  expect(msCreateTable(table('L', [field('B', 'number', { primaryKey: true }), short('A', 5, { primaryKey: true }), short('Nom', 40, { required: true, default: { k: 'str', v: "O'Brien" } }),
    field('Ok', 'yesNo', { default: { k: 'bool', v: true } })], { schema: 's]' }), 'v'))
    .toBe("CREATE TABLE [s]]].[L] ([B] int NOT NULL, [A] nvarchar(5) NOT NULL, [Nom] nvarchar(40) NOT NULL DEFAULT N'O''Brien', [Ok] bit NOT NULL DEFAULT 1, [v] rowversion, PRIMARY KEY ([B], [A]))");
  expect(msCreateTable(table('K', [field('X', 'dateTime', { default: { k: 'date', v: '2026-01-02 03:04:05' } })]), 'bc_rowversion'))
    .toBe("CREATE TABLE [dbo].[K] ([X] datetime2(0) DEFAULT '2026-01-02T03:04:05', [bc_rowversion] rowversion)");
});

it('R5: the rowversion column is bc_rowversion, else the first bc_rowversion<n> no field has (compared without case)', () => {
  expect(msVersionColumn(table('T', [auto('N°')]))).toBe('bc_rowversion');
  expect(msVersionColumn(table('T', [auto('N°'), short('BC_RowVersion', 5), short('bc_rowversion1', 5)]))).toBe('bc_rowversion2');
});

it('a multi-row INSERT: IDENTITY_INSERT around it, each value a parameter cast to its column type (text as sent: a value too long fails)', () => {
  expect(msInsertRows(table('T', [auto('N°'), short('Nom', 40), field('M', 'currency')]), 2)).toBe('SET IDENTITY_INSERT [dbo].[T] ON; '
    + 'INSERT INTO [dbo].[T] ([N°], [Nom], [M]) VALUES (CAST(@p0 AS int), @p1, CAST(@p2 AS money)), (CAST(@p3 AS int), @p4, CAST(@p5 AS money)); SET IDENTITY_INSERT [dbo].[T] OFF');
  expect(msInsertRows(table('U]', [short('Code', 5, { primaryKey: true }), field('Le', 'dateTime'), yesNo('Ok'), field('Q', 'number', { numberSize: 'byte' }),
    field('D', 'number', { numberSize: 'decimal', precision: 28, scale: 10 }), field('Lt', 'longText')]), 1))
    .toBe('INSERT INTO [dbo].[U]]] ([Code], [Le], [Ok], [Q], [D], [Lt]) VALUES (@p0, CAST(@p1 AS datetime2(0)), CAST(@p2 AS bit), CAST(@p3 AS tinyint), CAST(@p4 AS decimal(28,10)), @p5)');
});

it('finish: the identity reseeded so the next number is nextId, then the indexes (a unique one ignores Nulls, as Access)', () => {
  const tt = table("T'", [auto('N°'), short('Code', 5), short('A', 5, { required: true }), short('B', 5)], { nextId: 6, rows: 3, indexes: [
    { name: 'T_Code', fields: [{ name: 'Code', desc: false }], unique: true },
    { name: 'T_A]B', fields: [{ name: 'A', desc: false }, { name: 'B', desc: true }], unique: true },
    { name: 'T_N', fields: [{ name: 'N°', desc: false }, { name: 'B', desc: false }], unique: false }] });
  expect(msFinishTable(tt)).toEqual(["DBCC CHECKIDENT (N'[dbo].[T'']', RESEED, 5)",
    'CREATE UNIQUE INDEX [T_Code] ON [dbo].[T\'] ([Code]) WHERE [Code] IS NOT NULL',
    'CREATE UNIQUE INDEX [T_A]]B] ON [dbo].[T\'] ([A], [B] DESC) WHERE [B] IS NOT NULL',
    'CREATE INDEX [T_N] ON [dbo].[T\'] ([N°], [B])']);
  // a foreign key cannot reference a filtered index: rebuilt without its filter
  expect(msUnfiltered(tt, tt.indexes[0]!)).toBe('DROP INDEX [T_Code] ON [dbo].[T\']; CREATE UNIQUE INDEX [T_Code] ON [dbo].[T\'] ([Code])');
  // an empty table: no row was ever inserted, so the first one takes the reseed value itself
  expect(msFinishTable(table('E', [auto('N°')], { nextId: 7, rows: 0 }))).toEqual(["DBCC CHECKIDENT (N'[dbo].[E]', RESEED, 7)"]);
  expect(msFinishTable(table('U', [short('Code', 5)]))).toEqual([]);
  expect(() => msFinishTable(table('E', [auto('N°')], { nextId: 1.5 }))).toThrow('bc:invalidArgument');
});

const fk = (parent: string, child: string, o: Partial<ServerForeignKey> = {}): ServerForeignKey => ({ name: `${parent}${child}`, relation: `${parent}${child}`, schema: 'dbo',
  child, childFields: [parent], parent, parentFields: ['id'], onDelete: 'cascade', onUpdate: 'cascade', ...o });

it('foreign keys with their cascades', () => {
  expect(msForeignKey(fk('Clients', 'Commandes', { name: 'Cl]Co', childFields: ['Client'], parentFields: ['N°'], onUpdate: 'noAction' })))
    .toBe('ALTER TABLE [dbo].[Commandes] ADD CONSTRAINT [Cl]]Co] FOREIGN KEY ([Client]) REFERENCES [dbo].[Clients] ([N°]) ON DELETE CASCADE ON UPDATE NO ACTION');
  expect(msForeignKey(fk('P', 'C', { childFields: ['A', 'B'], parentFields: ['X', 'Y'], onDelete: 'noAction' })))
    .toBe('ALTER TABLE [dbo].[C] ADD CONSTRAINT [PC] FOREIGN KEY ([A], [B]) REFERENCES [dbo].[P] ([X], [Y]) ON DELETE NO ACTION ON UPDATE CASCADE');
});

it('msCascadeDowngrades: a second path to one table, a cycle and a self-reference lose their cascades; the rest keep them', () => {
  // A→B cascade, A→C cascade, B→D cascade, C→D cascade: C→D downgraded; E→E cascade: downgraded; F→G cascade: kept
  const none = { onDelete: 'noAction', onUpdate: 'noAction' } as const;
  const fks = [fk('A', 'B'), fk('A', 'C', { onUpdate: 'noAction' }), fk('B', 'D', { onDelete: 'noAction' }), fk('C', 'D'), fk('E', 'E'), fk('F', 'G')];
  expect(msCascadeDowngrades(fks)).toEqual([fks[0], fks[1], fks[2], { ...fks[3], ...none }, { ...fks[4], ...none }, fks[5]]);
  // a cycle G→H→G; a second foreign key between the same tables; a NO ACTION one makes no path; an ancestor's own path
  const more = [fk('G', 'H'), fk('H', 'G'), fk('G', 'H', { name: 'GH2' }), fk('X', 'Y', none), fk('Y', 'Z'), fk('X', 'Z'), fk('W', 'X'), fk('W', 'Z')];
  expect(msCascadeDowngrades(more)).toEqual([more[0], { ...more[1], ...none }, { ...more[2], ...none }, more[3], more[4], more[5], more[6], { ...more[7], ...none }]);
});
