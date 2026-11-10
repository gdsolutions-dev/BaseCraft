import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { registerFunctions } from '../main/db/file-format';
import { listRelations } from '../main/db/relations';
import { listTables } from '../main/db/schema';
import { run } from './main';
import { tmp } from './test-tmp';

const sample = fileURLToPath(new URL('../../tests/cli/example-script.json', import.meta.url));

describe('end to end', () => {
  it('builds a two-table base with a relation from the sample script', async () => {
    const p = tmp();
    const err: string[] = [];
    const io = { out: () => {}, err: (s: string) => err.push(s) };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', sample, p], io)).toBe(0);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listTables(db).map((t) => t.name).sort()).toEqual(['Clients', 'Commandes']);
    expect(listRelations(db)).toHaveLength(1);
    db.close();
    const before = fs.readFileSync(p);
    expect(await run(['script', sample, p], io)).toBe(1);
    expect(err.join('\n')).toContain('Clients');
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('format', () => {
  it('a fresh new base passes checkTarget at the current format (1.4)', async () => {
    const { checkTarget } = await import('./script');
    const p = tmp();
    expect(await run(['new', p], { out: () => {}, err: () => {} })).toBe(0);
    expect(() => checkTarget(p)).not.toThrow();
    const db = new DatabaseSync(p);
    expect((db.prepare("SELECT value FROM bc_meta WHERE key='format_minor'").get() as { value: string }).value).toBe('4');
    db.close();
  });

  it('creates a form with a chart and lists it with the charts command', async () => {
    const p = tmp(), spec = p.replace('x.basecraft', 'chart.json');
    const chart = { kind: 'chart', name: 'Chart1', left: 0, top: 0, width: 4000, height: 3000, props: { ChartAxis: ['Nom'], ChartValues: [{ field: 'ID', agg: 'count' }] } };
    const doc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [{ kind: 'detail', height: 4000, props: {}, controls: [chart] }] };
    fs.writeFileSync(spec, JSON.stringify([{ op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'Nom', type: 'shortText' }] }, { op: 'form.create', name: 'F', layout: 'doc', doc }]));
    const io = { out: () => {}, err: () => {} };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', spec, p], io)).toBe(0);
    const out: string[] = [];
    expect(await run(['charts', p], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual([{ object: { kind: 'form', name: 'F' }, control: 'Chart1', type: 'columnClustered', source: null }]);
  });

  it('F5a : le script crée un nuage de points, refuse un Nuage de mots ; la commande charts affiche le type', async () => {
    const p = tmp(), spec = p.replace('x.basecraft', 'chart5.json'), bad = p.replace('x.basecraft', 'chart5bad.json');
    const doc = (ChartType: string) => ({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [{ kind: 'detail', height: 4000, props: {}, controls: [
      { kind: 'chart', name: 'Nuage', left: 0, top: 0, width: 4000, height: 3000, props: { ChartType, ChartAxis: ['ID'], ChartValues: [{ field: 'ID', agg: 'none' }] } }] }] });
    const tbl = { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }] };
    fs.writeFileSync(spec, JSON.stringify([tbl, { op: 'form.create', name: 'F', layout: 'doc', doc: doc('scatter') }]));
    fs.writeFileSync(bad, JSON.stringify([tbl, { op: 'form.create', name: 'F', layout: 'doc', doc: doc('wordCloud') }]));
    const io = { out: () => {}, err: () => {} };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', bad, p], io)).toBe(1);
    expect(await run(['script', spec, p], io)).toBe(0);
    const out: string[] = [];
    expect(await run(['charts', p], { out: (x) => out.push(x), err: () => {} })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual([{ object: { kind: 'form', name: 'F' }, control: 'Nuage', type: 'scatter', source: null }]);
  });
});
