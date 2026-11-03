import { it, expect } from 'vitest';
import { bcErrorCode, errorMessage } from './Modal';
import { i18n } from '../i18n';
import type { QueryBindErrorCode } from '../../shared/query/bind';

it('extracts the bc: code even behind the Electron prefix, whose channel name also starts with bc:', () => {
  expect(bcErrorCode(new Error("Error invoking remote method 'bc:base:open': Error: bc:notBasecraft"))).toBe('notBasecraft');
  expect(bcErrorCode(new Error('bc:exists'))).toBe('exists');
  expect(bcErrorCode(new Error("Error invoking remote method 'bc:base:open': Error: boom"))).toBeNull();
  expect(bcErrorCode('nothing')).toBeNull();
});

it('reads `bc:<code>|<sub-code>|<detail>`: the code, then the sub-code key with its fallback and the detail', () => {
  const ipc = (m: string) => new Error(`Error invoking remote method 'bc:sources:describe': Error: ${m}`);
  expect(bcErrorCode(new Error('bc:queryBind|unknownSource|Clients'))).toBe('queryBind');
  expect(bcErrorCode(ipc('bc:queryBind|unknownSource|Clients'))).toBe('queryBind');
  expect(bcErrorCode(ipc('bc:queryBind|unknownSource|x bc:foo'))).toBe('queryBind'); // a detail never reads as the code
  expect(errorMessage(ipc('bc:queryBind|circular|QA → QB → QA'))).toEqual({ key: 'dialog.error.queryBind_circular', params: { name: 'circular', detail: 'QA → QB → QA', reason: '' } });
  expect(errorMessage(ipc('bc:invalidQuery|unexpectedEnd|13'))).toEqual({ key: 'dialog.error.invalidQuery', params: { name: 'unexpectedEnd', detail: '13', reason: i18n.t('expr.error.unexpectedEnd') } });
  expect(errorMessage(new TypeError('bc:invalidQuery'))).toEqual({ key: 'dialog.error.invalidQuery', params: { name: '', detail: 'bc:invalidQuery', reason: '' } });
  expect(errorMessage(ipc('bc:invalidParameter|invalidDate|Date début :'))).toMatchObject({ key: 'dialog.error.invalidParameter', params: { detail: 'Date début :' } });
  expect(errorMessage(ipc('boom'))).toEqual({ key: 'dialog.error.unknown', params: { name: '', detail: 'boom', reason: '' } });
});

it('every query error code has its message', () => {
  const bind: Record<QueryBindErrorCode, 0> = { unknownSource: 0, ambiguousField: 0, circular: 0, tooDeep: 0, notGrouped: 0, aggregateInWhere: 0,
    nestedAggregate: 0, unionArity: 0, updateTarget: 0, unknownTarget: 0, duplicateOutput: 0, insertArity: 0, subqueryArity: 0, memberNotAllowed: 0, mixedSources: 0 };
  const keys = [...['invalidQuery', 'queryBind', 'notSelectQuery', 'missingParameter', 'invalidParameter', 'cancelled', 'hostCrashed',
    'invalidQuery_subqueryRows', 'invalidQuery_tooComplex', 'invalidQuery_storedQuery'], ...Object.keys(bind).map((c) => `queryBind_${c}`)];
  for (const lng of ['fr', 'en']) for (const k of keys) expect(i18n.exists(`dialog.error.${k}`, { lng }), `${lng} ${k}`).toBe(true);
});

it('the message of an error: its bc: code translated, else the unknown error with its detail', () => {
  expect(errorMessage(new Error("Error invoking remote method 'bc:objects:setDescription': Error: bc:readOnly")))
    .toEqual({ key: 'dialog.error.readOnly', params: { name: '', detail: 'bc:readOnly', reason: '' } });
  expect(errorMessage(new Error('boom'))).toEqual({ key: 'dialog.error.unknown', params: { name: '', detail: 'boom', reason: '' } });
  expect(errorMessage(new Error('bc:noSuchCode'))).toMatchObject({ key: 'dialog.error.unknown' });
});

it('server errors name the function and the product', () => {
  expect(errorMessage(new Error('bc:serverFunction|Format|sqlserver')).params.detail).toBe('SQL Server');
  expect(errorMessage(new Error('bc:serverFunction|Format|postgresql'))).toMatchObject({ key: 'dialog.error.serverFunction', params: { name: 'Format', detail: 'PostgreSQL' } });
  expect(errorMessage(new Error('bc:serverNotSupported|actionQuery|postgresql'))).toMatchObject({ key: 'dialog.error.serverNotSupported_actionQuery', params: { detail: 'PostgreSQL' } });
  // `other` is the bare key: i18next reads a `_other` suffix as a plural form
  expect(errorMessage(new Error('bc:serverNotSupported|other|postgresql'))).toMatchObject({ key: 'dialog.error.serverNotSupported', params: { detail: 'PostgreSQL' } });
  for (const lng of ['fr', 'en']) for (const k of ['serverFunction', 'serverNotSupported', ...['actionQuery', 'joinSave', 'crosstab', 'topPercent', 'makeTable', 'appendAutoNumber'].map((x) => `serverNotSupported_${x}`)]) {
    expect(i18n.exists(`dialog.error.${k}`, { lng }), `${lng} ${k}`).toBe(true);
  }
  expect(i18n.t('dialog.error.serverFunction', { lng: 'fr', name: 'Format', detail: 'PostgreSQL' })).toBe('Format ne peut pas s\'exécuter sur une source PostgreSQL : BaseCraft ne sait pas le traduire pour ce serveur.');
});
