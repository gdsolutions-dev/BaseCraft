import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chartSvg } from './svg';

const size = { width: 400, height: 240 };
const column = (title?: string) => ({
  title: title ? { text: title } : undefined,
  xAxis: { type: 'category', data: ['A', 'B'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [3, 5], itemStyle: { color: '#2f6f9f' } }],
});
const three = {
  legend: {},
  xAxis: { type: 'category', data: ['x', 'y', 'z'] },
  yAxis: { type: 'value' },
  series: [1, 2, 3].map((n) => ({ type: 'bar', name: `S${n}`, data: [n, n + 1, n + 2] })),
};
const fancy = {
  title: { text: 'zr12' },
  legend: {},
  xAxis: { type: 'category', data: ['a', 'b', 'c'] },
  yAxis: { type: 'value' },
  series: [
    { type: 'line', name: 'zr3-cls-1', data: [1, 3, 2], areaStyle: {} },
    {
      type: 'bar',
      name: 'g',
      data: [2, 1, 3],
      itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] } },
    },
  ],
};
const golden = fileURLToPath(new URL('./fixtures/column-basic.svg', import.meta.url));

describe('chartSvg', () => {
  it('correspond au golden', () => {
    const svg = chartSvg(column(), size);
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden, svg);
    expect(svg).toBe(readFileSync(golden, 'utf8'));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 240"');
  });
  it('est déterministe, quel que soit l’ordre des appels', () => {
    const a = chartSvg(column(), size);
    expect(chartSvg(column(), size)).toBe(a);
    chartSvg(three, size);
    expect(chartSvg(column(), size)).toBe(a);
    const f = chartSvg(fancy, size);
    chartSvg(three, size);
    expect(chartSvg(fancy, size)).toBe(f);
    expect(f).toContain('>zr12<');
    expect(f).toContain('>zr3-cls-1<');
    expect(f).toContain('linearGradient');
  });
  it('ne contient rien d’actif ni d’invalide', () => {
    const svg = chartSvg(three, size);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain(' on' + 'click=');
    expect(svg.replace(/xmlns(:\w+)?="[^"]*"/g, '')).not.toContain('http://');
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  it('échappe les noms de catégorie et de série', () => {
    const evil = '<img src=x onerror=1>';
    const svg = chartSvg({ legend: {}, xAxis: { type: 'category', data: [evil] }, yAxis: { type: 'value' }, series: [{ type: 'bar', name: evil, data: [1] }] }, size);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });
  it('échappe le titre', () => {
    const svg = chartSvg(column('<img src=x onerror=1>'), size);
    expect(svg).toContain('&lt;img');
    expect(svg).not.toContain('<img');
  });
});
