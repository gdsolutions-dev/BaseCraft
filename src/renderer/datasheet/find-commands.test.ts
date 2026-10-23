import { describe, expect, it } from 'vitest';
import { goToRow } from './find-commands';

describe('goToRow', () => {
  it('moves within the saved records', () => {
    expect(goToRow('first', 4, 10)).toBe(0);
    expect(goToRow('last', 4, 10)).toBe(9);
    expect(goToRow('next', 9, 10)).toBe(9);
    expect(goToRow('previous', 0, 10)).toBe(0);
    expect(goToRow('next', null, 10)).toBe(1);
    expect(goToRow('previous', 5, 10)).toBe(4);
  });
  it('new record always; nothing to go to in an empty table', () => {
    expect(goToRow('new', 3, 10)).toBe('new');
    expect(goToRow('last', null, 0)).toBeNull();
    expect(goToRow('new', null, 0)).toBe('new');
  });
});
