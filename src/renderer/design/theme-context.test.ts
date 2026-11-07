import { expect, it, vi } from 'vitest';

it('modeOf: data-theme wins, otherwise the system', async () => {
  vi.stubGlobal('window', {}); // the module imports the bridge, which reads window.basecraft
  const { modeOf } = await import('./theme-context');
  expect(modeOf('dark', false)).toBe('dark');
  expect(modeOf('light', true)).toBe('light');
  expect(modeOf(null, true)).toBe('dark');
  expect(modeOf(null, false)).toBe('light');
  expect(modeOf('system', true)).toBe('dark');
});
