// Références membres [TempVars]![x], [Forms]![F]![C]… : racines, et remplacement par des littéraux. Module pur.
import type { Expr, Value } from './ast';
import { fromSerial, infoOf } from './library';
import { toDecimal } from '../coerce';

export type MemberRoot = 'Forms' | 'Reports' | 'TempVars' | 'LocalVars' | 'MacroError';

/** Racine canonique -> nom français affiché et longueur de la chaîne (racine comprise). */
export const MEMBER_ROOTS: Record<MemberRoot, { fr: string; arity: 2 | 3 }> = {
  Forms: { fr: 'Formulaires', arity: 3 },
  Reports: { fr: 'États', arity: 3 },
  TempVars: { fr: 'VarTemp', arity: 2 },
  LocalVars: { fr: 'VarLocales', arity: 2 },
  MacroError: { fr: 'ErreurMacro', arity: 2 },
};

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const BY_NAME = new Map(Object.entries(MEMBER_ROOTS).flatMap(([canon, r]) => [[fold(canon), canon], [fold(r.fr), canon]]));

/** Nom écrit (canonique ou français, casse et accents ignorés) -> racine canonique, ou undefined. */
export const memberRoot = (name: string): MemberRoot | undefined => BY_NAME.get(fold(name)) as MemberRoot | undefined;

/** Valeur -> littéral qui la redonne à l'évaluation. Empty (Nz sans remplacement) n'a pas de littéral : Null. */
export function literalOf(v: Value): Expr {
  if (v === null || v.t === 'empty') return { k: 'null' };
  switch (v.t) {
    case 'num': {
      const n: Expr = { k: 'num', v: toDecimal(Math.abs(v.v), infoOf('en-US'))! };
      return v.v < 0 ? { k: 'un', op: '-', e: n } : n;
    }
    case 'str': return { k: 'str', v: v.v };
    case 'date': return { k: 'date', v: fromSerial(v.v) };
    case 'bool': return { k: 'bool', v: v.v };
  }
}

/** L'arbre où chaque membre est remplacé par le littéral de sa valeur : une condition Where part en SQL sans membre, ses
 *  valeurs en paramètres. Les sous-requêtes ne sont pas parcourues (une condition Where n'en a pas). */
export async function bindMembers(e: Expr, resolve: (path: string[]) => Promise<Value>): Promise<Expr> {
  const b = (x: Expr): Promise<Expr> => bindMembers(x, resolve);
  switch (e.k) {
    case 'member': return literalOf(await resolve(e.path));
    case 'un': return { ...e, e: await b(e.e) };
    case 'bin': return { ...e, l: await b(e.l), r: await b(e.r) };
    case 'like': return { ...e, e: await b(e.e), pattern: await b(e.pattern) };
    case 'between': return { ...e, e: await b(e.e), lo: await b(e.lo), hi: await b(e.hi) };
    case 'in': { const x = await b(e.e); const list: Expr[] = []; for (const i of e.list) list.push(await b(i)); return { ...e, e: x, list }; }
    case 'isnull': case 'inSub': return { ...e, e: await b(e.e) };
    case 'call': { const args: Expr[] = []; for (const a of e.args) args.push(await b(a)); return { ...e, args }; }
    default: return e;
  }
}
