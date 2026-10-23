import { describe, expect, it } from 'vitest';
import type { Relation } from '../../shared/api';
import { fromQbe, type QbeDesign } from '../../shared/query/qbe';
import { printSql } from '../../shared/query/print';
import { defaultJoins, editable, fieldEntry, gridRows, pruneInvalid, designProblem, emptyQbe, outputAll, parseTop, qbeReducer, ROWS_MIN, topText } from './qbe-edit';

const rel: Relation = { name: 'ClientsCommandes', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
  enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 };
const rel2: Relation = { ...rel, name: 'PE' };
const withClients: QbeDesign = { ...emptyQbe(), tables: [{ name: 'Clients' }] };
const oneCol = qbeReducer(withClients, { type: 'addField', table: 'Clients', field: 'Nom' });

describe('defaultJoins', () => {
  it('default joins from relations', () => expect(defaultJoins([{ name: 'Clients' }], 'Commandes', [rel])).toEqual([{ l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'inner' }]));
  it('a two-field relation gives two joins', () => expect(defaultJoins([{ name: 'P' }], 'E', [{ ...rel2, parentTable: 'P', parentFields: ['a', 'b'], childTable: 'E', childFields: ['x', 'y'] }])).toHaveLength(2));
  it('join type 2 keeps every parent row (left, parent on the left), 3 every child row (right); added parent works too', () => {
    expect(defaultJoins([{ name: 'Commandes' }], 'Clients', [{ ...rel, joinType: 2 }])).toEqual([{ l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'left' }]);
    expect(defaultJoins([{ name: 'Clients' }], 'Commandes', [{ ...rel, joinType: 3 }])[0].kind).toBe('right');
  });
  it('no join to an unrelated box, none on the same names (no AutoJoin), a copy is joined by its alias', () => {
    expect(defaultJoins([{ name: 'Produits' }], 'Commandes', [rel])).toEqual([]);
    expect(defaultJoins([{ name: 'Clients', alias: 'C' }], 'Commandes', [rel], 'Commandes_1')).toEqual([{ l: 'C', lField: 'N°', r: 'Commandes_1', rField: 'Client', kind: 'inner' }]);
  });
});

describe('qbeReducer', () => {
  it('second copy gets an alias', () => expect(qbeReducer(withClients, { type: 'addTable', name: 'Clients', relations: [] }).tables[1]).toEqual({ name: 'Clients', alias: 'Clients_1' }));
  it('adding a table adds the joins of its relations', () => {
    const d = qbeReducer(withClients, { type: 'addTable', name: 'Commandes', relations: [rel] });
    expect(d.joins).toEqual([{ l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'inner' }]);
    const gone = qbeReducer(qbeReducer(d, { type: 'addField', table: 'Commandes', field: 'Montant' }), { type: 'removeTable', alias: 'Commandes' });
    expect(gone.tables).toEqual([{ name: 'Clients' }]);
    expect(gone.joins).toEqual([]);
    expect(gone.columns).toEqual([]);
  });
  it('joins: add (once), kind, remove', () => {
    const j = { l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'inner' as const };
    let d = qbeReducer(qbeReducer(withClients, { type: 'addJoin', join: j }), { type: 'addJoin', join: j });
    expect(d.joins).toHaveLength(1);
    d = qbeReducer(d, { type: 'setJoinKind', index: 0, kind: 'left' });
    expect(d.joins[0].kind).toBe('left');
    expect(qbeReducer(d, { type: 'removeJoin', index: 0 }).joins).toEqual([]);
  });
  it('the kind of a join is the kind of every join between the same two boxes (one FROM join), read from each side', () => {
    const j = (lField: string, rField: string, l = 'P', r = 'E') => ({ l, lField, r, rField, kind: 'inner' as const });
    const d = { ...emptyQbe(), tables: [{ name: 'P' }, { name: 'E' }, { name: 'X' }], joins: [j('a', 'x'), j('y', 'b', 'E', 'P'), j('a', 'z', 'P', 'X')] };
    expect(qbeReducer(d, { type: 'setJoinKind', index: 0, kind: 'left' }).joins.map((x) => x.kind)).toEqual(['left', 'right', 'inner']);
  });
  it('addField: a bracketed field with its table, * as is, Group By under totals, into the first empty column', () => {
    expect(oneCol.columns).toEqual([{ uid: 1, field: '[Nom]', table: 'Clients', show: true, criteria: ['', '', ''] }]);
    const t = qbeReducer({ ...oneCol, totals: true }, { type: 'addField', table: 'Clients', field: '*' });
    expect(t.columns[1]).toMatchObject({ field: '*', table: 'Clients', total: 'groupBy' });
    const gap = qbeReducer(qbeReducer(oneCol, { type: 'insertColumn', at: 0 }), { type: 'addField', table: 'Clients', field: 'Ville' });
    expect(gap.columns.map((c) => c.field)).toEqual(['[Ville]', '[Nom]']);
    expect(qbeReducer(oneCol, { type: 'addField', table: 'Clients', field: 'Ville', at: 0 }).columns.map((c) => c.field)).toEqual(['[Ville]', '[Nom]']);
  });
  it('totals on adds groupBy, off removes total', () => {
    const d = qbeReducer(qbeReducer(oneCol, { type: 'setTotals', on: true }), { type: 'setTotals', on: false });
    expect(qbeReducer(oneCol, { type: 'setTotals', on: true }).columns[0].total).toBe('groupBy');
    expect(d.columns[0].total).toBeUndefined();
    expect(d.totals).toBe(false);
  });
  it('update kind hides sort/show, keeps criteria', () => {
    const s = qbeReducer(qbeReducer(oneCol, { type: 'setCell', col: 0, row: 'sort', value: 'desc' }), { type: 'setCell', col: 0, row: 'criteria0', value: '"Dupont"' });
    const u = qbeReducer(qbeReducer(s, { type: 'setTotals', on: true }), { type: 'setKind', kind: 'update' });
    expect(u.kind).toBe('update');
    expect(u.totals).toBe(false);
    expect(u.columns[0]).toMatchObject({ show: true, criteria: ['"Dupont"', '', ''] });
    expect(u.columns[0].sort).toBeUndefined();
    expect(u.columns[0].total).toBeUndefined();
    const back = qbeReducer(qbeReducer(u, { type: 'setCell', col: 0, row: 'updateTo', value: '"x"' }), { type: 'setKind', kind: 'select' });
    expect(back.columns[0].updateTo).toBeUndefined();
  });
  it('delete kind: * is From, a field Where; make-table and append keep their target', () => {
    const d = qbeReducer(qbeReducer(oneCol, { type: 'addField', table: 'Clients', field: '*' }), { type: 'setKind', kind: 'delete' });
    expect(d.columns.map((c) => c.deleteRole)).toEqual(['where', 'from']);
    expect(qbeReducer(oneCol, { type: 'setKind', kind: 'makeTable', target: 'Copie' })).toMatchObject({ kind: 'makeTable', target: 'Copie' });
    expect(qbeReducer(oneCol, { type: 'setKind', kind: 'select', target: 'Copie' }).target).toBeUndefined();
  });
  it('typing in the last Or row adds another Or row', () => expect(qbeReducer(oneCol, { type: 'setCell', col: 0, row: 'criteria2', value: '"x"' }).columns[0].criteria).toHaveLength(4));
  it('setCell: past the last column pads empty columns; table, total, show, append to, delete role', () => {
    const d = qbeReducer(oneCol, { type: 'setCell', col: 2, row: 'field', value: '[Ville]' });
    expect(d.columns.map((c) => [c.uid, c.field])).toEqual([[1, '[Nom]'], [2, ''], [3, '[Ville]']]);
    expect(d.columns[2].criteria).toEqual(['', '', '']);
    let e = qbeReducer(d, { type: 'setCell', col: 2, row: 'table', value: 'Clients' });
    e = qbeReducer(e, { type: 'setCell', col: 2, row: 'show', value: false });
    e = qbeReducer(e, { type: 'setCell', col: 2, row: 'appendTo', value: 'Ville' });
    expect(e.columns[2]).toMatchObject({ table: 'Clients', show: false, appendTo: 'Ville' });
    expect(qbeReducer(e, { type: 'setCell', col: 2, row: 'table', value: '' }).columns[2].table).toBeUndefined();
    expect(qbeReducer({ ...e, totals: true }, { type: 'setCell', col: 2, row: 'total', value: 'sum' }).columns[2].total).toBe('sum');
    expect(qbeReducer(e, { type: 'setCell', col: 0, row: 'sort', value: '' }).columns[0].sort).toBeUndefined();
  });
  it('insert, delete and move columns', () => {
    const d = qbeReducer(qbeReducer(oneCol, { type: 'addField', table: 'Clients', field: 'Ville' }), { type: 'moveColumn', from: 1, to: 0 });
    expect(d.columns.map((c) => c.field)).toEqual(['[Ville]', '[Nom]']);
    expect(qbeReducer(d, { type: 'deleteColumn', at: 0 }).columns.map((c) => c.field)).toEqual(['[Nom]']);
    expect(qbeReducer(d, { type: 'insertColumn', at: 1 }).columns.map((c) => c.field)).toEqual(['[Ville]', '', '[Nom]']);
  });
  it('the grid gives the e2e query', () => {
    let d = qbeReducer(withClients, { type: 'addTable', name: 'Commandes', relations: [rel] });
    d = qbeReducer(d, { type: 'addField', table: 'Clients', field: 'Nom' });
    d = qbeReducer(d, { type: 'addField', table: 'Commandes', field: 'Montant' });
    d = qbeReducer(d, { type: 'setCell', col: 1, row: 'sort', value: 'desc' });
    d = qbeReducer(d, { type: 'setCell', col: 1, row: 'criteria0', value: '> 0.5' });
    expect(printSql(fromQbe(d))).toBe('SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Montant] > 0.5\nORDER BY [Commandes].[Montant] DESC;');
  });
});

describe('fieldEntry (the Field cell, as Access fills the Table row)', () => {
  const boxes = [{ alias: 'Clients', fields: ['N°', 'Nom'] }, { alias: 'Commandes', fields: ['N°', 'Montant'] }];
  it('a qualified field or * takes its box; a bare field the first box that has it; else it stays an expression', () => {
    expect(fieldEntry('[Commandes].[N°]', boxes)).toEqual({ field: '[N°]', table: 'Commandes' });
    expect(fieldEntry('Total: [Clients].[Nom]', boxes)).toEqual({ field: 'Total: [Nom]', table: 'Clients' });
    expect(fieldEntry('[Clients].*', boxes)).toEqual({ field: '*', table: 'Clients' });
    expect(fieldEntry('[Montant]', boxes)).toEqual({ field: '[Montant]', table: 'Commandes' });
    expect(fieldEntry('[N°]', boxes, 'Commandes')).toEqual({ field: '[N°]', table: 'Commandes' });
    expect(fieldEntry('[Combien ?]', boxes)).toEqual({ field: '[Combien ?]' });
    expect(fieldEntry('[Montant] * 2', boxes, 'Commandes')).toEqual({ field: '[Montant] * 2' });
    expect(fieldEntry('[Inconnue].[X]', boxes)).toEqual({ field: '[Inconnue].[X]' });
  });
});

describe('checks before saving', () => {
  it('no shown field, an append without Append To, a multi-table delete without From', () => {
    expect(designProblem(withClients)).toBe('bc:invalidQuery|noField|');
    expect(designProblem(qbeReducer(oneCol, { type: 'setCell', col: 0, row: 'show', value: false }))).toBe('bc:invalidQuery|noField|');
    expect(designProblem(oneCol)).toBeNull();
    expect(designProblem(qbeReducer(oneCol, { type: 'setKind', kind: 'append', target: 'T' }))).toBe('bc:invalidQuery|noField|');
    expect(designProblem(qbeReducer(oneCol, { type: 'setKind', kind: 'update' }))).toBe('bc:invalidQuery|noField|');
    expect(designProblem(qbeReducer(oneCol, { type: 'setKind', kind: 'delete' }))).toBeNull();
    const two = qbeReducer(qbeReducer(oneCol, { type: 'addTable', name: 'Commandes', relations: [rel] }), { type: 'setKind', kind: 'delete' });
    expect(designProblem(two)).toBe('bc:invalidQuery|deleteFrom|');
    expect(designProblem(qbeReducer(two, { type: 'addField', table: 'Commandes', field: '*' }))).toBeNull();
  });
  it('at least three criteria rows; a grid read from SQL gets them, and its column numbers', () => {
    expect(ROWS_MIN).toBe(3);
    expect(editable({ ...withClients, columns: [{ field: '[Nom]', table: 'Clients', show: true, criteria: ['"a"'] }] }).columns)
      .toEqual([{ uid: 1, field: '[Nom]', table: 'Clients', show: true, criteria: ['"a"', '', ''] }]);
  });
});

describe('grid rows and cell errors', () => {
  it('the rows of each kind, as Access shows them', () => {
    expect(gridRows(oneCol)).toEqual(['field', 'table', 'sort', 'show', 'criteria0', 'criteria1', 'criteria2']);
    expect(gridRows({ ...oneCol, totals: true, kind: 'append' })).toEqual(['field', 'table', 'total', 'sort', 'appendTo', 'criteria0', 'criteria1', 'criteria2']);
    expect(gridRows({ ...oneCol, kind: 'update' }).slice(0, 3)).toEqual(['field', 'table', 'updateTo']);
    expect(gridRows({ ...oneCol, kind: 'delete' }).slice(0, 3)).toEqual(['field', 'table', 'deleteRole']);
  });
  it('an error stays only on a cell the grid still shows', () => {
    const errs = { '1:criteria0': 'x', '1:updateTo': 'x', '9:field': 'x', 'new0:field': 'x', 'new3:criteria1': 'x', 'new3:updateTo': 'x' };
    expect(pruneInvalid(errs, oneCol)).toEqual({ '1:criteria0': 'x', 'new3:criteria1': 'x' });
    expect(pruneInvalid(errs, { ...oneCol, kind: 'update' })).toEqual({ '1:criteria0': 'x', '1:updateTo': 'x', 'new3:criteria1': 'x' });
    // a column whose Field was cleared keeps only its Field and criteria cells
    const cleared = qbeReducer(qbeReducer(oneCol, { type: 'setKind', kind: 'update' }), { type: 'setCell', col: 0, row: 'field', value: '' });
    expect(pruneInvalid({ '1:updateTo': 'x', '1:field': 'x' }, cleared)).toEqual({ '1:field': 'x' });
  });
});

describe('Insert Rows / Delete Rows (criteria rows), query properties', () => {
  const two = editable({ ...withClients, columns: [
    { field: '[Nom]', table: 'Clients', show: true, criteria: ['"A"', '"B"'] },
    { field: '[Ville]', table: 'Clients', show: true, criteria: ['', '"Lyon"'] },
  ] });
  it('Insert Rows adds an empty criteria row above the given one in every column; Delete Rows removes it', () => {
    const d = qbeReducer(two, { type: 'insertRow', at: 1 });
    expect(d.columns.map((c) => c.criteria.slice(0, 3))).toEqual([['"A"', '', '"B"'], ['', '', '"Lyon"']]);
    expect(d.columns[0].criteria).toHaveLength(4); // the spare « Or » row stays
    const back = qbeReducer(d, { type: 'deleteRow', at: 1 });
    expect(back.columns.map((c) => c.criteria)).toEqual(two.columns.map((c) => c.criteria));
    const first = qbeReducer(two, { type: 'deleteRow', at: 0 });
    expect(first.columns.map((c) => c.criteria[0])).toEqual(['"B"', '"Lyon"']);
    expect(first.columns[0].criteria).toHaveLength(ROWS_MIN);
    expect(printSql(fromQbe(first))).toBe('SELECT [Clients].[Nom], [Clients].[Ville]\nFROM [Clients]\nWHERE [Clients].[Nom] = "B" And [Clients].[Ville] = "Lyon";');
  });
  it('Top Values: All, a number or a percentage, as Access\'s box reads them', () => {
    expect(parseTop('', 'Tout')).toBeNull();
    expect(parseTop(' tout ', 'Tout')).toBeNull();
    expect(parseTop('25', 'Tout')).toEqual({ n: 25, percent: false });
    expect(parseTop('5 %', 'Tout')).toEqual({ n: 5, percent: true });
    for (const bad of ['0', '-3', '2.5', '101%', 'abc', '1e3']) expect(parseTop(bad, 'Tout'), bad).toBeUndefined();
    expect(topText(undefined, 'All')).toBe('All');
    expect(topText({ n: 25, percent: true }, 'All')).toBe('25%');
  });
  it('properties: Top Values, Unique Values, Output All Fields (a bare * column first), Parameters, into the SQL', () => {
    let d = qbeReducer(two, { type: 'setProps', top: { n: 5, percent: true }, distinct: true, outputAll: true, params: [{ name: 'Mini', type: 'currency' }] });
    expect(outputAll(d)).toBe(true);
    expect(d.columns[0]).toMatchObject({ field: '*', show: true });
    expect(d.columns[0]).not.toHaveProperty('table');
    expect(printSql(fromQbe(d))).toBe('PARAMETERS [Mini] Currency;\nSELECT DISTINCT TOP 5 PERCENT *, [Clients].[Nom], [Clients].[Ville]\nFROM [Clients]\nWHERE [Clients].[Nom] = "A" Or [Clients].[Nom] = "B" And [Clients].[Ville] = "Lyon";');
    expect(qbeReducer(d, { type: 'setProps', outputAll: true }).columns).toHaveLength(3); // already there
    d = qbeReducer(d, { type: 'setProps', top: null, distinct: false, outputAll: false });
    expect(outputAll(d)).toBe(false);
    expect(d).not.toHaveProperty('top');
    expect(printSql(fromQbe(d))).toMatch(/^PARAMETERS \[Mini\] Currency;\nSELECT \[Clients\]\.\[Nom\], /);
  });
});
