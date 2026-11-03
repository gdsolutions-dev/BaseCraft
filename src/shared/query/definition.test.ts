import { expect, it } from 'vitest';
import { isActionDefinition, parseQueryDefinition, passThroughOf, queryDependents } from './definition';

const P = { host: 'db.example.com', port: 5432, database: 'compta', user: 'bob', tls: 'verify-full', timeout: 60 };
const PT = { formatVersion: '2.0', sql: "SELECT string_agg(nom, ', ') FROM clients;", passThrough: { kind: 'postgresql', params: P, returnsRecords: true } };

it('a pass-through definition is kept as typed, never parsed', () => {
  expect(parseQueryDefinition(PT).sql).toBe(PT.sql);
  for (const bad of [{ ...PT, sql: '  ' }, { ...PT, passThrough: { ...PT.passThrough, kind: 'mysql' } }, { ...PT, passThrough: { ...PT.passThrough, params: { ...P, password: 'x' } } },
    { ...PT, passThrough: undefined }, { ...PT, formatVersion: '1.0', sql: 'UPDATE x SET' }]) expect(() => parseQueryDefinition(bad)).toThrow('bc:invalidQuery');
  expect(passThroughOf({ ...PT, formatVersion: '1.0' })).toBeNull();
});
it('isActionDefinition', () => {
  expect(isActionDefinition({ ...PT, passThrough: { ...PT.passThrough, returnsRecords: false } })).toBe(true);
  expect(isActionDefinition(PT)).toBe(false);
  expect(isActionDefinition({ formatVersion: '1.0', sql: 'DELETE FROM T' })).toBe(true);
  expect(isActionDefinition({ formatVersion: '1.0', sql: 'SELECT * FROM T' })).toBe(false);
});
it('queryDependents never reads a pass-through text as Access SQL', () => {
  expect(queryDependents('Clients', [{ kind: 'query', name: 'P', definition: { ...PT, sql: 'SELECT * FROM Clients' } }])).toEqual([]);
});
