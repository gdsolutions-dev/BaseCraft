// R6: a Python function name reaching SQL, a filter or a table rule is refused with the clear message.
import { afterEach, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { errorMessage } from '../shell/Modal';
import { designErrorText } from './error-text';
import { setUserFunctions } from '../../shared/expr/user-functions';
import { parseSql } from '../../shared/query/sql-parser';
import { validateDesign } from '../../shared/field-types';
import { f, t } from '../../shared/test-fixtures';
import { invalidQueryError } from '../../shared/query/definition';

afterEach(() => setUserFunctions([]));
const python = (name: string) => i18n.t('expr.error.pythonNotAllowed', { name });

it('table design: a Validation Rule, a Default Value and the table rule calling a function', () => {
  const errs = validateDesign({ ...t('T', [f('Prix', 'currency', { validationRule: 'remise([Prix])>0', defaultValue: 'remise(1)' })]), validationRule: 'remise([Prix])>0' });
  expect(errs.map((e) => e.fn)).toEqual(['remise', 'remise', 'remise']);
  expect(designErrorText(errs[0])).toBe(i18n.t('expr.error.unknownFunction', { name: 'remise' }));   // not registered
  setUserFunctions(['remise']);
  for (const e of errs) expect(designErrorText(e)).toBe(python('remise'));
});

it('SQL view: a stored query calling a function reports its name; the dialog says Python', () => {
  let err: unknown;
  try { parseSql('SELECT remise(Prix) FROM Produits'); } catch (e) { err = invalidQueryError(e); }
  expect((err as Error).message).toBe('bc:invalidQuery|unknownFunction|7|remise');
  expect(errorMessage(err).key).toBe('dialog.error.invalidQuery');
  setUserFunctions(['remise']);
  expect(errorMessage(err)).toMatchObject({ key: 'expr.error.pythonNotAllowed', params: { name: 'remise' } });
  expect(errorMessage(new Error('bc:invalidFilter|unknownFunction|remise'))).toMatchObject({ key: 'expr.error.pythonNotAllowed' });
  expect(errorMessage(new Error('bc:invalidFilter|unknownFunction|autre')).key).toBe('dialog.error.invalidFilter');
});
