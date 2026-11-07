import { describe, expect, it } from 'vitest';
import { openDesigns, registerOpenDesign } from './open-designs';

describe('open designs registry', () => {
  it('registers, lists by kind and unregisters', () => {
    const clearTheme = () => {};
    const offA = registerOpenDesign({ kind: 'form', name: 'A', clearTheme });
    const offB = registerOpenDesign({ kind: 'report', name: 'B', clearTheme });
    expect(openDesigns('form').map((d) => d.name)).toEqual(['A']);
    expect(openDesigns('report').map((d) => d.name)).toEqual(['B']);
    offA();
    expect(openDesigns('form')).toEqual([]);
    offB(); offB();
    expect(openDesigns('report')).toEqual([]);
  });
});
