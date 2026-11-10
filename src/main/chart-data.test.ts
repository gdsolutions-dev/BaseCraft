import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { Session } from './session';
import { seedSales } from './query/test-db';
import type { ChartDataRequest } from '../shared/chart/query';
import type { ChartSpec } from '../shared/chart/spec';

let dir: string;
let p: string;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const open = (id = 'a') => { const s = Session.open(p, { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: id }); opened.push(s); return s; };
const spec = (o: Partial<ChartSpec>): ChartSpec => ({ type: 'columnClustered', source: null, axis: [], dateGroup: 'none', legend: '', values: [], ...o });
const req = (o: Partial<ChartSpec>, source: ChartDataRequest['source'] = { kind: 'table', name: 'Clients' }, extra: Partial<ChartDataRequest> = {}): ChartDataRequest => ({ spec: spec(o), source, ...extra });
const count = () => { const db = new DatabaseSync(p, { readOnly: true }); try { return Object.values(db.prepare('SELECT count(*) FROM Commandes').get() as object)[0]; } finally { db.close(); } };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcchart-'));
  p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
  db.close();
});
afterEach(() => { for (const s of opened.splice(0)) s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('Session.chartData', () => {
  it('groups a table in category order', async () => {
    const r = await open().chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }));
    expect(r.truncated).toBe(false);
    expect(r.columns.map((c) => c.role)).toEqual(['category', 'value']);
    const cats = r.rows.map((x) => String(x[0]));
    expect(cats).toEqual([...cats].sort((a, b) => a.localeCompare(b)));
    expect(r.rows.reduce((n, x) => n + Number(x[1]), 0)).toBe(4);
  });
  it('sums a saved query', async () => {
    const s = open();
    s.saveObject('query', 'QCmd', { formatVersion: '1.0', sql: 'SELECT Client, Montant FROM Commandes' }, null);
    const r = await s.chartData(req({ axis: ['Client'], values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'query', name: 'QCmd' }));
    expect(r.rows.map((x) => x[0])).toEqual([1, 2, 3]);
    expect(Number(r.rows[0][1])).toBeCloseTo(10.2);
  });
  it('legend + axis gives [category, legend, value]', async () => {
    const r = await open().chartData(req({ axis: ['Le'], legend: 'Client', values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'table', name: 'Commandes' }));
    expect(r.columns.map((c) => c.role)).toEqual(['category', 'legend', 'value']);
    expect(r.rows.every((x) => x.length === 3)).toBe(true);
  });
  it('caps at 5000 points and flags truncated', async () => {
    const db = new DatabaseSync(p);
    db.exec('BEGIN');
    const ins = db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)');
    for (let i = 0; i < 5002; i++) ins.run(`n${String(i).padStart(5, '0')}`, 'X');
    db.exec('COMMIT');
    db.close();
    const r = await open().chartData(req({ axis: ['Nom'], values: [{ field: 'N°', agg: 'sum' }] }));
    expect(r.rows).toHaveLength(5000);
    expect(r.truncated).toBe(true);
  });
  it.each([[4996, false], [4997, true]])('boundary: %i added names -> truncated %s, 5000 rows', async (extra, truncated) => {
    const db = new DatabaseSync(p);
    db.exec('BEGIN');
    const ins = db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)');
    for (let i = 0; i < extra; i++) ins.run(`n${String(i).padStart(5, '0')}`, 'X');
    db.exec('COMMIT');
    db.close();
    const r = await open().chartData(req({ axis: ['Nom'], values: [{ field: 'N°', agg: 'sum' }] }));
    expect(r.rows).toHaveLength(5000);
    expect(r.truncated).toBe(truncated);
  });
  it('declared params do not override the link', async () => {
    const r = await open().chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }, undefined, { link: { fields: ['Nom'], values: ['Dupont'] }, params: { link0: 'Martin' } }));
    expect(r.rows).toEqual([['Lyon', 1]]);
  });
  it('a sql source declaring link0 with a link is refused', async () => {
    const source = { kind: 'sql', sql: 'PARAMETERS link0 Text; SELECT Ville, Nom FROM Clients WHERE Nom = [link0]' } as const;
    await expect(open().chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }, source, { link: { fields: ['Nom'], values: ['Dupont'] } }))).rejects.toThrow('bc:invalidArgument');
  });
  it('link values are parameters', async () => {
    const s = open();
    const q = (v: string) => s.chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }, undefined, { link: { fields: ['Nom'], values: [v] } }));
    expect((await q('Dupont')).rows).toEqual([['Lyon', 1]]);
    expect((await q("x' OR '1'='1")).rows).toEqual([]);
  });
  it('refuses a hostile source and changes nothing', async () => {
    const s = open();
    await expect(s.chartData(req({ axis: ['Client'], values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'sql', sql: 'DELETE FROM Commandes' }))).rejects.toThrow(/bc:(notSelectQuery|invalidArgument)/);
    expect(count()).toBe(5);
  });
  it('a hostile field name is notFound', async () => {
    await expect(open().chartData(req({ axis: ['Ville"; DROP TABLE Clients; --'], values: [{ field: 'Nom', agg: 'count' }] }))).rejects.toThrow('bc:notFound');
  });
  it('a missing table is notFound', async () => {
    await expect(open().chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }, { kind: 'table', name: 'Nope' }))).rejects.toThrow('bc:notFound');
  });
  it('works on a read-only base', async () => {
    open('a');
    const b = open('b');
    expect(b.state.readOnly).toBe(true);
    expect((await b.chartData(req({ axis: ['Ville'], values: [{ field: 'Nom', agg: 'count' }] }))).rows.length).toBeGreaterThan(0);
  });
  it('a scatter returns numeric [X, Y] rows', async () => {
    const r = await open().chartData(req({ type: 'scatter', axis: ['Client'], values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'table', name: 'Commandes' }));
    expect(r.columns.map((c) => c.role)).toEqual(['category', 'value']);
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every((x) => typeof x[0] === 'number' && typeof x[1] === 'number')).toBe(true);
  });
  it('a rows chart filters by link like a grouped one', async () => {
    const r = await open().chartData(req({ type: 'scatter', axis: ['Client'], values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'table', name: 'Commandes' }, { link: { fields: ['Client'], values: [1] } }));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x[0] === 1)).toBe(true);
  });
  it('a rows chart works on a read-only base', async () => {
    open('a');
    const b = open('b');
    expect((await b.chartData(req({ type: 'boxWhisker', axis: ['Client'], values: [{ field: 'Montant', agg: 'sum' }] }, { kind: 'table', name: 'Commandes' }))).rows).toHaveLength(5);
  });
});
