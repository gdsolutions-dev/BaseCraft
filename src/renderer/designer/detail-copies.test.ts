import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ControlDef, SectionDef } from '../../shared/design/model';
import { DetailCopies, extraRowCount } from './DesignCanvas';
import type { EmptyCell } from '../../shared/design/layout';
import { twipsToPx } from './units';

describe('extraRowCount (copies of a continuous Detail in Layout view)', () => {
  it('a single record: no copy', () => expect(extraRowCount(1, twipsToPx(340), 800, 25)).toBe(0));
  it('capped by the records read (25 of 100 rows)', () => expect(extraRowCount(25, twipsToPx(340), 800, 25)).toBe(24));
  it('capped by the rows the source has', () => expect(extraRowCount(3, twipsToPx(340), 800, 25)).toBe(2));
  it('capped by what fits in the viewport', () => expect(extraRowCount(25, 300, 800, 25)).toBe(3));
  it('a Detail without height: no copy', () => expect(extraRowCount(25, 0, 800, 25)).toBe(0));
});

describe('DetailCopies', () => {
  const c: ControlDef = { kind: 'textBox', name: 'Nom', left: 15, top: 30, width: 1500, height: 300, props: {} };
  const s: SectionDef = { kind: 'detail', height: 600, props: {}, controls: [c] };
  const html = renderToStaticMarkup(createElement(DetailCopies, { s, count: 2, render: (_c: ControlDef, _s: SectionDef, row: number) => `rec${row}` }));
  it('draws `count` copies, records 1… after the current one', () => {
    expect(html.match(/dz-copy/g)).toHaveLength(2);
    expect(html).toContain('rec1');
    expect(html).toContain('rec2');
  });
  it('the copies are not selectable: no data-ctl, no handles, no section body, no pointer events', () => {
    expect(html).not.toContain('data-ctl');
    expect(html).not.toContain('data-handle');
    expect(html).not.toContain('data-section-body');
    expect(html).toContain('pointer-events:none');
  });
});

describe('DetailCopies empty cells', () => {
  const c: ControlDef = { kind: 'textBox', name: 'Nom', left: 15, top: 30, width: 1500, height: 300, props: {} };
  const s: SectionDef = { kind: 'detail', height: 600, props: {}, controls: [c] };
  const cell = (col: number): EmptyCell => ({ layout: 'L1', row: 0, col, section: 'detail' as EmptyCell['section'], props: { BackColor: '#ff0000' }, rect: { left: 1600 * col, top: 0, width: 1500, height: 240 } });
  const render = (_c: ControlDef, _s: SectionDef, row: number) => `rec${row}:${_c.name}`;
  it('draws one fill per empty cell in every copy', () => {
    const html = renderToStaticMarkup(createElement(DetailCopies, { s, count: 2, render, cells: [cell(1), cell(2)] }));
    expect(html.match(/dz-cellfill/g)).toHaveLength(4);
    expect(html).toContain('rec1:cell!L1!0!1');
  });
  it('no cells: same markup as before', () => {
    const a = renderToStaticMarkup(createElement(DetailCopies, { s, count: 2, render }));
    expect(renderToStaticMarkup(createElement(DetailCopies, { s, count: 2, render, cells: [] }))).toBe(a);
    expect(a).not.toContain('dz-cellfill');
  });
});
