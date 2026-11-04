// R6: an expression error kept as a code string shows as `expr.error.<code>`; `pythonNotAllowed:<name>` carries the function's name.
import type { TFunction } from 'i18next';
import { i18n } from '../i18n';
import { userFunctionNames } from '../../shared/expr/user-functions';

export function exprErrorText(t: TFunction, code: string): string {
  const i = code.indexOf(':');
  return i < 0 ? t(`expr.error.${code}`) : t(`expr.error.${code.slice(0, i)}`, { name: code.slice(i + 1) });
}

/** One table design error as text; an expression calling an unknown function says so, a Python one is refused clearly. */
export function designErrorText(e: { code: string; prop?: string; fn?: string }): string {
  const t = i18n.t.bind(i18n);
  if (e.fn) return t(userFunctionNames().has(e.fn.toLowerCase()) ? 'expr.error.pythonNotAllowed' : 'expr.error.unknownFunction', { name: e.fn });
  return t(`designError.${e.code}`, e.prop ? { prop: t(`fieldProp.${e.prop}`) } : {});
}
