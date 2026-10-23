// Filtres de la feuille de données : un critère canonique par champ (mode critère, le champ en sujet), combinés par And,
// compilés par compileSql (fonctions bc_*, valeurs en paramètres liés : une valeur n'est jamais du SQL).
import type { FieldFilter } from '../../shared/api';
import { parseCanonical } from '../../shared/expr/parser';
import { compileSql, type SqlFragment } from '../../shared/expr/sql';
import { sameName, type TableDesign } from '../../shared/field-types';

const invalid = (why: string): never => { throw new Error(`bc:invalidFilter ${why}`); };

/** `locale`: the data region (text read as a number or a date). sql '' without a criterion. Throws bc:invalidFilter for an
 *  unknown field, a criterion that does not parse, names an unknown field or exceeds SQLite's limits. */
export function compileFilter(design: TableDesign, filter: FieldFilter[], locale: string): SqlFragment {
  const fields = design.fields.map((x) => ({ name: x.name, type: x.props.type, numberSize: x.props.numberSize }));
  const parts = filter.map(({ field, criteria }) => {
    const fd = design.fields.find((x) => sameName(x.name, field)) ?? invalid(`field ${field}`);
    try {
      return compileSql(parseCanonical(criteria, { criteria: true }), { fields, subject: fd.name, locale });
    } catch (e) {
      return invalid(`${field}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { sql: parts.map((p) => `(${p.sql})`).join(' AND '), params: parts.flatMap((p) => p.params) };
}
