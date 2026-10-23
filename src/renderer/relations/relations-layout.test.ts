import { describe, expect, it } from 'vitest';
import { f, t } from '../../shared/test-fixtures';
import { BOX_W, HEAD, MAX_ROWS, PAD, ROW, autoLayout, boxHeight, deleteRefusal, linePath, linkSides, relationFields, type Box } from './relations-layout';

const SLOT_H = boxHeight(MAX_ROWS);
const overlap = (p: { x: number; y: number }, q: { x: number; y: number }) =>
  p.x < q.x + BOX_W && q.x < p.x + BOX_W && p.y < q.y + SLOT_H && q.y < p.y + SLOT_H;
const fieldY = (b: Box, i: number) => b.y + HEAD + PAD + i * ROW + ROW / 2;

describe('autoLayout', () => {
  it('places new tables without overlap, keeps existing positions, drops tables no longer shown', () => {
    const existing = { tables: { B: { x: 30, y: 25 }, Gone: { x: 500, y: 500 } } };
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const l = autoLayout(names, existing, { w: 760, h: 500 });
    expect(Object.keys(l.tables).sort()).toEqual(names);
    expect(l.tables.B).toEqual({ x: 30, y: 25 });
    const pts = names.map((n) => l.tables[n]);
    pts.forEach((p, i) => pts.slice(i + 1).forEach((q) => expect(overlap(p, q), `${JSON.stringify(p)} ${JSON.stringify(q)}`).toBe(false)));
    for (const p of pts) expect(p.x + BOX_W).toBeLessThanOrEqual(760); // fits the width when it can
    expect(existing.tables).toHaveProperty('Gone'); // the input is not changed
  });

  it('tables named like Object.prototype members keep their own boxes', () => {
    const names = ['__proto__', 'constructor', 'prototype', 'toString'];
    const existing = { tables: JSON.parse('{"__proto__":{"x":7,"y":8}}') };
    const l = autoLayout(names, existing, { w: 2000, h: 500 });
    expect(Object.keys(l.tables)).toEqual(names);
    expect(Object.getOwnPropertyDescriptor(l.tables, '__proto__')?.value).toEqual({ x: 7, y: 8 });
  });

  it('a narrow window still gives one column', () => {
    const l = autoLayout(['A', 'B'], { tables: {} }, { w: 50, h: 50 });
    expect(l.tables.A.x).toBe(l.tables.B.x);
    expect(overlap(l.tables.A, l.tables.B)).toBe(false);
  });
});

describe('linePath', () => {
  const a: Box = { x: 20, y: 40, w: BOX_W, h: boxHeight(5) };
  const b: Box = { x: 400, y: 100, w: BOX_W, h: boxHeight(6) };

  it('joins the facing sides at the height of each field; "1" next to the parent, "∞" next to the child', () => {
    const { d, oneEnd, manyEnd } = linePath(a, 2, b, 4);
    expect(d.startsWith(`M ${a.x + a.w} ${fieldY(a, 2)} `)).toBe(true);
    expect(d.endsWith(`${b.x} ${fieldY(b, 4)}`)).toBe(true);
    expect(oneEnd.x).toBeGreaterThan(a.x + a.w);
    expect(oneEnd.x).toBeLessThan(a.x + a.w + 20);
    expect(Math.abs(oneEnd.y - fieldY(a, 2))).toBeLessThan(ROW);
    expect(manyEnd.x).toBeLessThan(b.x);
    expect(manyEnd.x).toBeGreaterThan(b.x - 20);
    expect(Math.abs(manyEnd.y - fieldY(b, 4))).toBeLessThan(ROW);
  });

  it('mirrors when the child is on the left', () => {
    const { d, oneEnd, manyEnd } = linePath(b, 0, a, 1);
    expect(d.startsWith(`M ${b.x} ${fieldY(b, 0)} `)).toBe(true);
    expect(d.endsWith(`${a.x + a.w} ${fieldY(a, 1)}`)).toBe(true);
    expect(oneEnd.x).toBeLessThan(b.x);
    expect(manyEnd.x).toBeGreaterThan(a.x + a.w);
  });

  it('boxes one above the other: both ends leave on the right', () => {
    const c: Box = { ...b, x: a.x + 50, y: 400 };
    const { d } = linePath(a, 0, c, 0);
    expect(d.startsWith(`M ${a.x + a.w} `)).toBe(true);
    expect(d.endsWith(`${c.x + c.w} ${fieldY(c, 0)}`)).toBe(true);
  });

  it('follows the scrolled field list and stays on the box when the field is scrolled out of view', () => {
    const long: Box = { ...a, h: boxHeight(30), scroll: 2 * ROW };
    expect(linePath(long, 3, b, 0).d.startsWith(`M ${a.x + a.w} ${fieldY(long, 1)} `)).toBe(true);
    expect(linePath(long, 25, b, 0).d.startsWith(`M ${a.x + a.w} ${long.y + long.h} `)).toBe(true);
    expect(linePath(long, 0, b, 0).d.startsWith(`M ${a.x + a.w} ${long.y + HEAD} `)).toBe(true);
  });
});

describe('relation dialog rows', () => {
  it('complete rows become the field pairs, in order', () => {
    expect(relationFields([['N°', 'Client'], ['Code', 'Réf']])).toEqual({ parentFields: ['N°', 'Code'], childFields: ['Client', 'Réf'] });
  });
  it('a row filled on one side only is refused, never zipped with another row', () => {
    // a parent field on row 0 and a child field on row 1 used to become one pair the user never drew
    expect(relationFields([['N°', ''], ['', 'Client']])).toEqual({ incomplete: [0, 1] });
    expect(relationFields([['N°', 'Client'], ['Code', '']])).toEqual({ incomplete: [1] });
  });
});

describe('a field dropped on a field of another table', () => {
  const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Email', 'shortText', { indexed: 'yesNoDuplicates' })]);
  const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number'), f('Contact', 'shortText')]);
  const lignes = t('Lignes', [f('Cmd', 'number', { primaryKey: true }), f('Pos', 'number', { primaryKey: true })]);
  const designs = new Map([clients, commandes, lignes].map((d) => [d.name, d]));
  const at = (table: string, field: string) => ({ table, field });

  it('the side unique on its own becomes the parent, whichever way the field was dragged', () => {
    expect(linkSides(at('Commandes', 'Client'), at('Clients', 'N°'), designs)).toEqual([at('Clients', 'N°'), at('Commandes', 'Client')]);
    expect(linkSides(at('Clients', 'N°'), at('Commandes', 'Client'), designs)).toEqual([at('Clients', 'N°'), at('Commandes', 'Client')]);
    expect(linkSides(at('Commandes', 'Contact'), at('Clients', 'Email'), designs)).toEqual([at('Clients', 'Email'), at('Commandes', 'Contact')]);
  });
  it('both unique or neither: the table dragged from is the parent; part of a composite key is not unique', () => {
    expect(linkSides(at('Commandes', 'N°'), at('Clients', 'N°'), designs)).toEqual([at('Commandes', 'N°'), at('Clients', 'N°')]);
    expect(linkSides(at('Clients', 'Nom'), at('Commandes', 'Contact'), designs)).toEqual([at('Clients', 'Nom'), at('Commandes', 'Contact')]);
    expect(linkSides(at('Commandes', 'N°'), at('Lignes', 'Cmd'), designs)).toEqual([at('Commandes', 'N°'), at('Lignes', 'Cmd')]);
    expect(linkSides(at('Lignes', 'Cmd'), at('Commandes', 'N°'), designs)).toEqual([at('Commandes', 'N°'), at('Lignes', 'Cmd')]);
  });
});

describe('a refused relation delete', () => {
  it('an external table gets the Relations window text, naming the table', () => {
    expect(deleteRefusal({ ok: false, reason: 'external', table: 'Commandes' }, 'R')).toEqual({ messageKey: 'relations.error.external', params: { table: 'Commandes' } });
  });
  it('other refusals use the Navigation Pane texts', () => {
    expect(deleteRefusal({ ok: false, reason: 'readOnly' }, 'R')).toEqual({ messageKey: 'dialog.op.readOnly', params: { name: 'R', table: '', view: '' } });
    expect(deleteRefusal({ ok: false, reason: 'viewBroken', view: 'V' }, 'R')).toEqual({ messageKey: 'dialog.op.viewBroken', params: { name: 'R', table: '', view: 'V' } });
  });
});
