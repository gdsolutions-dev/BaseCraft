import { describe, expect, it } from 'vitest';
import en from '../../shared/i18n/en.json';
import fr from '../../shared/i18n/fr.json';
import { FUNCTIONS } from '../../shared/expr/catalog';
import { localeInfo } from '../../shared/locale-format';
import { printSelect } from '../../shared/query/print';
import { QUERY_PARSE } from '../../shared/query/sql-parser';
import { check, functionSnippet, insertAt, items, type BuilderContext } from './builder-model';

const FR: BuilderContext = { fields: ['Qté'], lang: 'fr', region: localeInfo('fr-FR'), criteria: true };
const EN: BuilderContext = { fields: ['Qté'], lang: 'en', region: localeInfo('en-US'), criteria: false };

describe('insertAt', () => {
  it('inserts at the caret, spaced from its neighbours, the caret after it', () => {
    expect(insertAt('', 0, '[Qté]')).toEqual({ text: '[Qté]', caret: 5 });
    expect(insertAt('[Qté]', 5, '>')).toEqual({ text: '[Qté] >', caret: 7 });
    expect(insertAt('a', 0, 'b')).toEqual({ text: 'b a', caret: 1 });
    expect(insertAt('Gauche(; 2)', 7, '[Nom]')).toEqual({ text: 'Gauche([Nom]; 2)', caret: 12 });
  });
  it('a snippet with a placeholder: the caret on its first one', () => {
    expect(insertAt('1 +', 3, 'Abs(«nombre»)')).toEqual({ text: '1 + Abs(«nombre»)', caret: 8 });
  });
});

describe('functionSnippet', () => {
  it('names and separator of the language and region', () => {
    expect(functionSnippet('IIf', FR)).toBe('VraiFaux(«expr»; «vrai»; «faux»)');
    expect(functionSnippet('IIf', EN)).toBe('IIf(«expr», «truepart», «falsepart»)');
    expect(functionSnippet('IIf', { ...FR, region: localeInfo('en-US') })).toBe('VraiFaux(«expr», «vrai», «faux»)');
    expect(functionSnippet('Now', FR)).toBe('Maintenant()');
  });
  it('every function names each of its arguments, in both languages', () => {
    for (const f of FUNCTIONS) for (const c of [fr, en]) expect((c.expr.args as Record<string, string[]>)[f.name], f.name).toHaveLength(f.max);
  });
});

describe('check', () => {
  it('readable: the canonical form', () => {
    expect(check('[Qté] >0', FR)).toEqual({ ok: true, canonical: '[Qté] > 0' });
    expect(check('[qté] >= 1,5', FR)).toEqual({ ok: true, canonical: '[qté] >= 1.5' });
    expect(check('VraiFaux(Vrai; "a;b"; 2)', { ...FR, criteria: false })).toEqual({ ok: true, canonical: 'IIf(True, "a;b", 2)' });
    expect(check('  ', FR)).toEqual({ ok: true, canonical: '' });
  });
  it('unreadable: the code and the faulty part', () => {
    expect(check('> 1 +', FR)).toEqual({ ok: false, code: 'unexpectedEnd', span: { start: 4, end: 5 } }); // the dangling « + »
    expect(check('> 1 ) 2', FR)).toEqual({ ok: false, code: 'unexpectedToken', span: { start: 4, end: 5 } });
    expect(check('Gauche("a"; 2; 3)', FR)).toMatchObject({ ok: false, code: 'arity' });
    expect(check('VraiFaux(«expr»; 1; 2)', FR)).toEqual({ ok: false, code: 'unexpectedToken', span: { start: 9, end: 15 } }); // the placeholder
  });
  it('an aggregate is refused where no group exists (field and table rules, filters), accepted where one does', () => {
    expect(check('Somme([Qté]) > 1', { ...FR, criteria: false })).toEqual({ ok: false, code: 'aggregateContext', span: { start: 0, end: 16 } });
    expect(check('> Compte(*)', FR)).toMatchObject({ ok: false, code: 'aggregateContext' });
    expect(check('Somme([Qté])', { ...FR, criteria: false, aggregates: true })).toEqual({ ok: true, canonical: 'Sum([Qté])' });
  });
  it('a query grid cell (A3): qualified names, a subquery, and any name (a parameter) accepted', () => {
    const q: BuilderContext = { ...FR, query: { qualified: true, subquery: QUERY_PARSE.subquery, printSub: printSelect } };
    expect(check('> [Clients].[N°] + [Combien ?]', q)).toEqual({ ok: true, canonical: '> [Clients].[N°] + [Combien ?]' });
    expect(check('Dans (SELECT Client FROM Commandes)', q)).toMatchObject({ ok: true });
  });
  it('a field outside the list is refused, its name selected', () => {
    expect(check('[Prix] > 0', FR)).toEqual({ ok: false, code: 'unknownField', span: { start: 0, end: 6 } });
    expect(check('1 + Prix', { ...EN, fields: [] })).toEqual({ ok: false, code: 'unknownField', span: { start: 4, end: 8 } });
    expect(check('Abs(-1)', { ...EN, fields: [] })).toEqual({ ok: true, canonical: 'Abs(-1)' }); // a function is no field
  });
});

describe('items', () => {
  it('operators and constants in the language', () => {
    expect(items('operators', 'comparison', FR).map((x) => x.label)).toEqual(['=', '<>', '<', '<=', '>', '>=', 'Entre', 'Comme', 'Dans']);
    expect(items('constants', 'all', FR).map((x) => x.snippet)).toEqual(['""', 'Vrai', 'Faux', 'Null']);
    expect(items('fields', 'all', FR)).toEqual([{ label: 'Qté', snippet: '[Qté]' }]);
  });
  it('functions of a category, with their snippet and canonical name', () => {
    const logic = items('functions', 'logic', FR);
    expect(logic.find((x) => x.fn === 'IIf')).toEqual({ label: 'VraiFaux', snippet: 'VraiFaux(«expr»; «vrai»; «faux»)', fn: 'IIf' });
    const aggregates = FUNCTIONS.filter((f) => f.category === 'aggregate').map((f) => f.name);
    expect(aggregates).toContain('Sum');
    expect(items('functions', 'all', FR).filter((x) => aggregates.includes(x.fn!))).toEqual([]); // no group here: not offered
    expect(items('functions', 'all', FR)).toHaveLength(FUNCTIONS.length - aggregates.length);
    expect(items('functions', 'all', { ...FR, aggregates: true })).toHaveLength(FUNCTIONS.length);
  });
});
