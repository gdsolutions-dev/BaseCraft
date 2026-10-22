import { describe, expect, it } from 'vitest';
import { CloseVeto, HUNG_MS } from './close-veto';

describe('CloseVeto', () => {
  it('asks once, waits, and closes only when the request stays unanswered', () => {
    let t = 1000;
    const v = new CloseVeto(() => t);
    expect(v.request()).toBe('ask');
    t += HUNG_MS - 1;
    expect(v.request()).toBe('wait'); // a second click while the renderer is still answering
    t += 1;
    expect(v.request()).toBe('close'); // hung renderer
  });

  it('an acknowledged request lets the next close ask again, however late', () => {
    let t = 0;
    const v = new CloseVeto(() => t);
    expect(v.request()).toBe('ask');
    v.acknowledged(); // the user answered No to a question: the app stays
    t += 10 * HUNG_MS;
    expect(v.request()).toBe('ask');
  });
});
