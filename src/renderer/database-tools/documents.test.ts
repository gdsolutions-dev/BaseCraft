import { describe, expect, it } from 'vitest';
import type { Relation } from '../../shared/api';
import type { TableDesign } from '../../shared/field-types';
import { documenterHtml, relationshipReportHtml } from './documents';

const t = (k: string) => k;
const d = (name: string, ...fields: string[]): TableDesign => ({ name, fields: fields.map((f, i) => ({ name: f, props: { type: 'shortText', required: false, indexed: 'no', primaryKey: i === 0 } })) });
const rel: Relation = { name: 'R', parentTable: 'A<b>', parentFields: ['Id'], childTable: 'B', childFields: ['AId'], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 };

describe('relationship report', () => {
  const designs = new Map([['A<b>', d('A<b>', 'Id')], ['B', d('B', 'Id', 'AId')], ['Hidden', d('Hidden', 'Id')]]);
  const html = relationshipReportHtml(t, { base: 'Ventes & Co', date: '12 Nov 2026', designs, relations: [rel], layout: { tables: { 'A<b>': { x: 10, y: 10 }, B: { x: 400, y: 10 } } } });
  it('draws the shown tables with their fields and the relation, header with base and date, everything escaped', () => {
    expect(html).toContain('Ventes &amp; Co');
    expect(html).toContain('12 Nov 2026');
    expect(html).toContain('A&lt;b&gt;');
    expect(html).not.toContain('A<b>');
    expect(html).toContain('>AId</text>');
    expect(html).not.toContain('Hidden');
    expect(html).toContain('∞');
    expect(html).toMatch(/<path d="M /);
  });
  it('says so for an empty window', () => {
    expect(relationshipReportHtml(t, { base: 'B', date: 'd', designs, relations: [], layout: { tables: {} } })).toContain('dbtools.relReportEmpty');
  });
});

describe('database documenter', () => {
  const tbl: TableDesign = { name: 'Clients<x>', description: 'Les "clients"', fields: [
    { name: 'Id', props: { type: 'autoNumber', required: true, indexed: 'yesNoDuplicates', primaryKey: true } },
    { name: 'Nom', props: { type: 'shortText', size: 60, required: false, indexed: 'no', primaryKey: false, defaultValue: '"?"', description: 'Nom <b>' } }] };
  const form = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients<x>' }, props: {}, sections: [{ kind: 'detail', height: 1, props: {}, controls: [
    { kind: 'textBox', name: 'txtNom', left: 0, top: 0, width: 1, height: 1, props: { ControlSource: 'Nom' } }] }] };
  const macro = { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenForm', args: { FormName: 'F1', View: '' } },
    { k: 'if', branches: [{ cond: 'True', items: [{ k: 'action', action: 'Beep', args: {} }] }] }] };
  const rel: Relation = { name: 'R1', parentTable: 'Clients<x>', parentFields: ['Id'], childTable: 'B', childFields: ['CId'], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 };
  const on = { fields: true, indexes: true, relationships: true, controls: true };
  const html = documenterHtml(t, { base: 'Ventes', date: 'd', relations: [rel], options: on, items: [
    { kind: 'table', name: 'Clients<x>', design: tbl }, { kind: 'query', name: 'Q1', definition: { formatVersion: '1.0', sql: 'SELECT * FROM A WHERE x < 3 AND y = "a&b"' } },
    { kind: 'form', name: 'F1', definition: form }, { kind: 'macro', name: 'M1', definition: macro }] });
  it('lists a table\'s fields, indexes and relations, a query\'s SQL, a form\'s source and controls, a macro\'s actions, all escaped', () => {
    expect(html).toContain('<h2>tabs.kind.table: Clients&lt;x&gt;</h2>');
    expect(html).toContain('<td>Nom</td><td>fieldType.shortText</td><td>60</td>');
    expect(html).toContain('<td>&quot;?&quot;</td><td>Nom &lt;b&gt;</td>');
    expect(html).toContain('<td>PrimaryKey</td><td>Id</td><td>dialog.button.yes</td><td>dialog.button.yes</td>');   // the primary key index
    expect(html).toContain('<td>R1</td><td>Clients&lt;x&gt; (Id)</td><td>B (CId)</td>');
    expect(html).toContain('<pre>SELECT * FROM A WHERE x &lt; 3 AND y = &quot;a&amp;b&quot;</pre>');
    expect(html).toContain('<td>txtNom</td><td>sheet.kind.textBox</td><td>Nom</td>');
    expect(html).toContain('OpenForm(FormName=F1)');
    expect(html).toContain('If True');
    expect(html).not.toMatch(/<(b|x)>/);
  });
  it('leaves out what the options turn off', () => {
    const off = documenterHtml(t, { base: 'V', date: 'd', relations: [rel], options: { fields: false, indexes: false, relationships: false, controls: false },
      items: [{ kind: 'table', name: 'Clients<x>', design: tbl }, { kind: 'form', name: 'F1', definition: form }] });
    expect(off).not.toContain('dbtools.docFields');
    expect(off).not.toContain('dbtools.docControls');
    expect(off).toContain('dbtools.docRecordSource');
  });
});
