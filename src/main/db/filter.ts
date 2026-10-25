// Filtres de la feuille de données : un critère canonique par champ (mode critère, le champ en sujet), combinés par And,
// compilés par compileSql (fonctions bc_*, valeurs en paramètres liés : une valeur n'est jamais du SQL).
import type { FieldFilter } from '../../shared/api';
import { parseCanonical } from '../../shared/expr/parser';
import { compileSql, type SqlFragment } from '../../shared/expr/sql';
import { sameName, type FieldType, type NumberSize, type TableDesign } from '../../shared/field-types';

const invalid = (why: string): never => { throw new Error(`bc:invalidFilter ${why}`); };

/** `locale`: the data region (text read as a number or a date). sql '' without a criterion nor `where`. `where`: an opening's
 *  Where Condition (compileWhere), ANDed with the criteria. Throws bc:invalidFilter for an unknown field, a criterion that does
 *  not parse, names an unknown field or exceeds SQLite's limits. */
export function compileFilter(design: TableDesign, filter: FieldFilter[], locale: string, where?: string): SqlFragment {
  const fields = design.fields.map((x) => ({ name: x.name, type: x.props.type, numberSize: x.props.numberSize }));
  const parts = filter.map(({ field, criteria }) => {
    const fd = design.fields.find((x) => sameName(x.name, field)) ?? invalid(`field ${field}`);
    try {
      return compileSql(parseCanonical(criteria, { criteria: true }), { fields, subject: fd.name, locale });
    } catch (e) {
      return invalid(`${field}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  if (where !== undefined) parts.push(compileWhere(fields, where, locale));
  return { sql: parts.map((p) => `(${p.sql})`).join(' AND '), params: parts.flatMap((p) => p.params) };
}

/** A record-level condition (an opening's Where Condition, canonical) over `fields`: compileSql without subject. Throws
 *  bc:invalidFilter when it does not parse, names an unknown field or holds a member (`[TempVars]![x]`: values only in SQL). */
export function compileWhere(fields: { name: string; type: FieldType; numberSize?: NumberSize }[], where: string, locale: string): SqlFragment {
  try {
    return compileSql(parseCanonical(where), { fields, locale });
  } catch (e) {
    return invalid(`where: ${e instanceof Error ? e.message : String(e)}`);
  }
}
