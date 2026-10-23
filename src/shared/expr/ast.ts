// Arbre des expressions sous forme canonique. Module pur (aucune API Node).
import type { SelectQuery } from '../query/ast';

export type BinOp = '^' | '*' | '/' | '\\' | 'Mod' | '+' | '-' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'And' | 'Or' | 'Xor';

export type Expr =
  | { k: 'num'; v: string }                      // texte décimal canonique, exact
  | { k: 'str'; v: string } | { k: 'date'; v: string /* 'YYYY-MM-DD HH:MM:SS' */ } | { k: 'bool'; v: boolean } | { k: 'null' }
  | { k: 'id'; name: string; table?: string }    // [Champ] ou nom nu ; [T].[F] quand table est présent (option qualified)
  | { k: 'subject' }                             // sujet implicite du mode critère
  | { k: 'un'; op: '-' | 'Not'; e: Expr }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr }
  | { k: 'like'; e: Expr; pattern: Expr; not: boolean }
  | { k: 'between'; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: 'in'; e: Expr; list: Expr[]; not: boolean }
  | { k: 'isnull'; e: Expr; not: boolean }
  | { k: 'call'; name: string /* canonique, casse du catalogue */; args: Expr[] }
  | { k: 'star' }                                // `*` de Count(*), seulement comme argument de Count
  // Sous-requêtes (option subquery) : (SELECT …), Exists (SELECT …), x [Not] In (SELECT …)
  | { k: 'sub'; mode: 'scalar' | 'exists'; q: SelectQuery }
  | { k: 'inSub'; e: Expr; q: SelectQuery; not: boolean };

export interface Span { start: number; end: number }

export type ExprErrorCode =
  | 'unexpectedToken' | 'unexpectedEnd' | 'unclosedString' | 'unclosedBracket'
  | 'badDate' | 'badNumber' | 'unknownFunction' | 'arity'
  | 'tooComplex' // dépasse les limites de SQLite (compileSql)
  | 'subqueryNotAllowed'
  | 'unknownField' // générateur d'expressions : un champ qui n'est pas dans sa liste
  | 'aggregateContext' // saisie : un agrégat là où aucun regroupement n'existe (règle, valeur par défaut, filtre)
  // SQL dialect (A3 sql-parser)
  | 'forbiddenStatement' | 'reservedName' | 'multipleStatements' | 'notSupportedYet' | 'badParameterType';

export class ExprSyntaxError extends Error {
  constructor(public code: ExprErrorCode, public span: Span) {
    super(`${code} @${span.start}-${span.end}`);
    this.name = 'ExprSyntaxError';
  }
}

export type FunctionTable = Record<string, { min: number; max: number }>;

/** Valeur calculée. Une date est un numéro de série : jours depuis 1899-12-30, fraction = heure. */
export type Value = null | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'date'; v: number } | { t: 'bool'; v: boolean }
  | { t: 'empty' }; // Empty de VBA : produit seulement par Nz(v) sans valeur de remplacement

export type ExprRuntimeErrorCode = 'typeMismatch' | 'divByZero' | 'badArgument' | 'overflow' | 'unknownField'
  | 'aggregateContext'; // Sum, Count… hors d'un regroupement (requête Regroupement A3, groupe d'état A5)

export class ExprRuntimeError extends Error {
  constructor(public code: ExprRuntimeErrorCode) {
    super(code);
    this.name = 'ExprRuntimeError';
  }
}
