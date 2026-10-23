// Catalogue des fonctions et des mots-clés : nom canonique (anglais) <-> nom français. Module pur.
import type { FunctionTable } from './ast';
import type { FieldType } from '../field-types';

export type FnCategory = 'text' | 'number' | 'date' | 'logic' | 'conversion' | 'aggregate';
/** `ret` : type du résultat (bindQuery, A3) ; 'arg0' / 'arg1' = type du premier / deuxième argument. */
export interface FnInfo { name: string; fr: string; min: number; max: number; category: FnCategory; ret: FieldType | 'arg0' | 'arg1' }

const RET = new Map(Object.entries({
  shortText: 'Left Right Mid Trim LTrim RTrim UCase LCase Replace Space String Format CStr',
  number: 'Len InStr StrComp Round Int Fix Abs Sgn Sqr Val CInt CLng CDbl Year Month Day Hour Minute Second Weekday DateDiff '
    + 'DatePart Count StDev StDevP Var VarP',
  currency: 'CCur',
  dateTime: 'Date Time Now DateAdd DateSerial TimeSerial CDate',
  yesNo: 'IsNull IsNumeric IsDate CBool',
  arg0: 'Nz Sum Avg Min Max First Last',
  arg1: 'IIf',
}).flatMap(([ret, names]) => names.split(' ').map((n) => [n, ret as FnInfo['ret']])));

const f = (category: FnCategory, name: string, fr: string, min: number, max = min): FnInfo =>
  ({ name, fr, min, max, category, ret: RET.get(name)! });

export const FUNCTIONS: FnInfo[] = [
  f('logic', 'IIf', 'VraiFaux', 3), f('logic', 'Nz', 'Nz', 1, 2), f('logic', 'IsNull', 'EstNull', 1),
  f('logic', 'IsNumeric', 'EstNum', 1), f('logic', 'IsDate', 'EstDate', 1),
  f('text', 'Len', 'NbCar', 1), f('text', 'Left', 'Gauche', 2), f('text', 'Right', 'Droite', 2), f('text', 'Mid', 'ExtracChaîne', 2, 3),
  f('text', 'Trim', 'SupprEspace', 1), f('text', 'LTrim', 'SupprEspaceG', 1), f('text', 'RTrim', 'SupprEspaceD', 1),
  f('text', 'UCase', 'Majuscule', 1), f('text', 'LCase', 'Minuscule', 1), f('text', 'InStr', 'DansChaîne', 2, 3),
  f('text', 'Replace', 'Remplacer', 3), f('text', 'Space', 'Espace', 1), f('text', 'String', 'Chaîne', 2),
  f('text', 'StrComp', 'CompChaîne', 2, 3), f('text', 'Format', 'Format', 1, 2),
  f('number', 'Round', 'Arrondi', 1, 2), f('number', 'Int', 'Ent', 1), f('number', 'Fix', 'Tronque', 1),
  f('number', 'Abs', 'Abs', 1), f('number', 'Sgn', 'Signe', 1), f('number', 'Sqr', 'RacineCarrée', 1),
  f('conversion', 'Val', 'Val', 1), f('conversion', 'CStr', 'CChaîne', 1), f('conversion', 'CInt', 'CEnt', 1),
  f('conversion', 'CLng', 'CEntLong', 1), f('conversion', 'CDbl', 'CRéel', 1), f('conversion', 'CCur', 'CMonétaire', 1),
  f('conversion', 'CDate', 'CDate', 1), f('conversion', 'CBool', 'CBool', 1),
  f('date', 'Date', 'Date', 0), f('date', 'Time', 'Temps', 0), f('date', 'Now', 'Maintenant', 0),
  f('date', 'Year', 'Année', 1), f('date', 'Month', 'Mois', 1), f('date', 'Day', 'Jour', 1), f('date', 'Hour', 'Heure', 1),
  f('date', 'Minute', 'Minute', 1), f('date', 'Second', 'Seconde', 1), f('date', 'Weekday', 'JourSem', 1, 2),
  f('date', 'DateAdd', 'AjDate', 3), f('date', 'DateDiff', 'DiffDate', 3), f('date', 'DatePart', 'PartDate', 2),
  f('date', 'DateSerial', 'SérieDate', 3), f('date', 'TimeSerial', 'SérieHeure', 3),
  // Agrégats : évalués par A3 (SQL d'une requête Regroupement) et A5 (groupes d'un état), refusés ailleurs (aggregateContext).
  f('aggregate', 'Sum', 'Somme', 1), f('aggregate', 'Avg', 'Moyenne', 1), f('aggregate', 'Count', 'Compte', 1),
  f('aggregate', 'Min', 'Min', 1), f('aggregate', 'Max', 'Max', 1), f('aggregate', 'First', 'Premier', 1), f('aggregate', 'Last', 'Dernier', 1),
  f('aggregate', 'StDev', 'EcartType', 1), f('aggregate', 'StDevP', 'EcartTypeP', 1),
  f('aggregate', 'Var', 'Var', 1), f('aggregate', 'VarP', 'VarP', 1),
];

/** Noms canoniques des fonctions d'agrégat. */
export const AGGREGATES: ReadonlySet<string> = new Set(FUNCTIONS.filter((x) => x.category === 'aggregate').map((x) => x.name));

/** Nom canonique -> arité, pour `parseCanonical`. */
export const FUNCTION_TABLE: FunctionTable = Object.fromEntries(FUNCTIONS.map((x) => [x.name, { min: x.min, max: x.max }]));

export type KeywordName = 'And' | 'Or' | 'Not' | 'Xor' | 'Mod' | 'Like' | 'Between' | 'In' | 'Is' | 'Null' | 'True' | 'False';
export const KEYWORDS: Record<KeywordName, { fr: string }> = {
  And: { fr: 'Et' }, Or: { fr: 'Ou' }, Not: { fr: 'Pas' }, Xor: { fr: 'OuX' }, Mod: { fr: 'Mod' }, Like: { fr: 'Comme' },
  Between: { fr: 'Entre' }, In: { fr: 'Dans' }, Is: { fr: 'Est' }, Null: { fr: 'Null' }, True: { fr: 'Vrai' }, False: { fr: 'Faux' },
};
