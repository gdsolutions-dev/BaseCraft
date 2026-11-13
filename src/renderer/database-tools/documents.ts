// The HTML documents of Database Tools (relationship report, documenter): a header with the base name and the date, then the
// body. Pure module; every name and definition is escaped (htmlText). Rendered in a sandboxed frame and by the print window.
import type { ObjectKind, Relation, RelationsLayout } from '../../shared/api';
import { flattenControls, type DesignDoc } from '../../shared/design/model';
import { htmlText as h } from '../../shared/export-markup';
import type { TableDesign } from '../../shared/field-types';
import { indexRows } from '../table-design/indexes-model';
import { BOX_W, HEAD, MAX_ROWS, PAD, ROW, boxHeight, linePath, type Box } from '../relations/relations-layout';

export type T = (key: string, opts?: Record<string, unknown>) => string;

const CSS = `body{font:12px/1.4 "Segoe UI",Arial,sans-serif;color:#111;margin:16px}header{display:flex;justify-content:space-between;border-bottom:2px solid #333;margin-bottom:12px;padding-bottom:4px}`
  + `h1{font-size:18px;margin:0}h2{font-size:15px;margin:18px 0 4px;break-after:avoid}h3{font-size:12px;margin:8px 0 2px}table{border-collapse:collapse;margin:2px 0 6px}`
  + `th,td{border:1px solid #999;padding:2px 6px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;margin:2px 0 6px;padding:4px;border:1px solid #999}`
  + `.muted{color:#666}section{break-inside:avoid-page}svg{width:100%;height:auto}`;

/** A whole page: the title and the base name on the left, the date on the right. */
export const pageHtml = (title: string, body: string, base: string, date: string): string =>
  `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${h(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n`
  + `<header><h1>${h(title)} – ${h(base)}</h1><span>${h(date)}</span></header>\n${body}\n</body>\n</html>\n`;

/** Relationship Report: the Relationships window as it is now (the shown tables at their places, the relations as lines, « 1 » and
 *  « ∞ » on an enforced one), as an SVG scaled to the page. ponytail: a table shows its first 8 fields (as the window unscrolled);
 *  a name wider than its box overflows it. */
export function relationshipReportHtml(t: T, x: { base: string; date: string; designs: ReadonlyMap<string, TableDesign>; relations: Relation[]; layout: RelationsLayout }): string {
  const shown = Object.keys(x.layout.tables).filter((n) => x.designs.has(n));
  if (!shown.length) return pageHtml(t('ribbon.cmd.relationshipReport'), `<p class="muted">${h(t('dbtools.relReportEmpty'))}</p>`, x.base, x.date);
  const box = (n: string): Box => ({ ...x.layout.tables[n]!, w: BOX_W, h: boxHeight(x.designs.get(n)!.fields.length), scroll: 0 });
  const idx = (n: string, f: string) => x.designs.get(n)!.fields.findIndex((d) => d.name === f);
  const w = Math.max(...shown.map((n) => box(n).x + BOX_W)) + 40, ht = Math.max(...shown.map((n) => box(n).y + box(n).h)) + 40;
  const lines = x.relations.filter((r) => shown.includes(r.parentTable) && shown.includes(r.childTable)).map((r) => {
    const paths = r.parentFields.map((pf, i) => linePath(box(r.parentTable), idx(r.parentTable, pf), box(r.childTable), idx(r.childTable, r.childFields[i]!)));
    const { oneEnd, manyEnd } = paths[0]!;
    return `<g fill="none" stroke="#222" stroke-width="1.5">${paths.map((p) => `<path d="${p.d}"/>`).join('')}</g>`
      + (r.enforce ? `<text x="${oneEnd.x}" y="${oneEnd.y}" text-anchor="middle" font-size="13">1</text><text x="${manyEnd.x}" y="${manyEnd.y}" text-anchor="middle" font-size="13">∞</text>` : '');
  });
  const boxes = shown.map((n) => {
    const b = box(n), d = x.designs.get(n)!;
    return `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff" stroke="#222"/>`
      + `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${HEAD}" fill="#ddd" stroke="#222"/>`
      + `<text x="${b.x + 8}" y="${b.y + HEAD / 2 + 5}" font-size="14" font-weight="bold">${h(n)}</text>`
      + d.fields.slice(0, MAX_ROWS).map((f, i) => `<text x="${b.x + 10}" y="${b.y + HEAD + PAD + (i + 0.5) * ROW + 4}" font-size="12"${f.props.primaryKey ? ' font-weight="bold"' : ''}>${h(f.name)}</text>`).join('')
      + '</g>';
  });
  return pageHtml(t('ribbon.cmd.relationshipReport'), `<svg viewBox="0 0 ${w} ${ht}" xmlns="http://www.w3.org/2000/svg" data-testid="relationship-report">${lines.join('')}${boxes.join('')}</svg>`, x.base, x.date);
}

export interface DocOptions { fields: boolean; indexes: boolean; relationships: boolean; controls: boolean }
export type DocItem = { kind: 'table'; name: string; design: TableDesign } | { kind: Exclude<ObjectKind, 'module'>; name: string; definition: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const table = (head: string[], rows: string[][]): string =>
  `<table><thead><tr>${head.map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** A macro as indented lines: `Action(Arg=value; …)`, If / Else, submacros and groups. */
function macroLines(items: unknown, depth = 0, out: string[] = []): string[] {
  const pad = '\u00a0\u00a0'.repeat(depth);
  for (const i of Array.isArray(items) ? items : []) {
    if (!isObj(i)) continue;
    if (i.k === 'action') out.push(`${pad}${text(i.action)}(${Object.entries(isObj(i.args) ? i.args : {}).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${text(v)}`).join('; ')})`);
    else if (i.k === 'comment') out.push(`${pad}// ${text(i.text)}`);
    else if (i.k === 'group' || i.k === 'submacro') { out.push(`${pad}${i.k === 'group' ? 'Group' : 'Submacro'} ${text(i.name)}`); macroLines(i.items, depth + 1, out); }
    else if (i.k === 'if') {
      (Array.isArray(i.branches) ? i.branches : []).forEach((b, n) => { out.push(`${pad}${n ? 'Else If' : 'If'} ${text(isObj(b) ? b.cond : '')}`); macroLines(isObj(b) ? b.items : null, depth + 1, out); });
      if (Array.isArray(i.else)) { out.push(`${pad}Else`); macroLines(i.else, depth + 1, out); }
    }
  }
  return out;
}

/** Database Documenter: one section per picked object, in the order given: a table's fields, indexes and relations; a query's SQL;
 *  a form's or report's record source and controls; a macro's actions. */
export function documenterHtml(t: T, x: { base: string; date: string; items: DocItem[]; relations: Relation[]; options: DocOptions }): string {
  const yn = (b: boolean) => t(b ? 'dialog.button.yes' : 'dialog.button.no');
  const none = `<p class="muted">${h(t('dbtools.depsNone'))}</p>`;
  const body = x.items.map((it) => {
    let inner = '';
    if (it.kind === 'table') {
      const d = it.design;
      if (d.description) inner += `<p>${h(d.description)}</p>`;
      if (x.options.fields) {
        inner += `<h3>${h(t('dbtools.docFields'))}</h3>` + table([t('dbtools.docName'), t('dbtools.docType'), t('fieldProp.size'), t('fieldProp.required'), t('fieldProp.defaultValue'), t('dbtools.docDescription')],
          d.fields.map((f) => [f.name, t(`fieldType.${f.props.type}`), String(f.props.type === 'shortText' ? f.props.size ?? '' : f.props.type === 'number' ? t(`fieldProp.numberSizes.${f.props.numberSize ?? 'longInteger'}`) : ''),
            yn(f.props.required), f.props.defaultValue ?? '', f.props.description ?? '']));
      }
      if (x.options.indexes) {
        const rows = indexRows(d);
        inner += `<h3>${h(t('dbtools.docIndexes'))}</h3>` + (rows.length ? table([t('dbtools.docName'), t('dbtools.docFields'), t('indexes.primary'), t('indexes.unique')],
          rows.map((r) => [r.name, r.fields.map((f) => f.name + (f.desc ? ' ↓' : '')).join(', '), yn(r.primary), yn(r.unique)])) : none);
      }
      if (x.options.relationships) {
        const rels = x.relations.filter((r) => r.parentTable === it.name || r.childTable === it.name);
        inner += `<h3>${h(t('dbtools.docRelationships'))}</h3>` + (rels.length ? table([t('dbtools.docName'), t('dbtools.docParent'), t('dbtools.docChild'), t('dbtools.docEnforced')],
          rels.map((r) => [r.name, `${r.parentTable} (${r.parentFields.join(', ')})`, `${r.childTable} (${r.childFields.join(', ')})`, yn(r.enforce)])) : none);
      }
    } else if (it.kind === 'query') {
      inner += `<pre>${h(isObj(it.definition) ? text(it.definition.sql) : '')}</pre>`;
    } else if (it.kind === 'macro') {
      inner += `<pre>${macroLines(isObj(it.definition) ? it.definition.items : null).map(h).join('\n')}</pre>`;
    } else {
      const doc = (isObj(it.definition) ? it.definition : {}) as Partial<DesignDoc>;
      const rs = doc.recordSource;
      inner += `<h3>${h(t('dbtools.docRecordSource'))}</h3>` + (rs ? `<pre>${h(rs.kind === 'sql' ? rs.sql : rs.name)}</pre>` : none);
      if (x.options.controls) {
        const cs = (Array.isArray(doc.sections) ? doc.sections : []).flatMap((s) => flattenControls(Array.isArray(s?.controls) ? s.controls : []));
        inner += `<h3>${h(t('dbtools.docControls'))}</h3>` + (cs.length ? table([t('dbtools.docName'), t('dbtools.docType'), t('dbtools.docSource')],
          cs.map((c) => [c.name, t(`sheet.kind.${c.kind}`, { defaultValue: c.kind }), text(c.props?.ControlSource) || text(c.props?.SourceObject) || text(c.props?.RowSource)])) : none);
      }
    }
    return `<section><h2>${h(t(`tabs.kind.${it.kind}`))}: ${h(it.name)}</h2>${inner}</section>`;
  });
  return pageHtml(t('ribbon.cmd.databaseDocumenter'), body.join('\n') || none, x.base, x.date);
}
