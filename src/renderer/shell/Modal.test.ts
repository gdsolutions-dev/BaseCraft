import { it, expect } from 'vitest';
import { bcErrorCode } from './Modal';

it('extracts the bc: code even behind the Electron prefix, whose channel name also starts with bc:', () => {
  expect(bcErrorCode(new Error("Error invoking remote method 'bc:base:open': Error: bc:notBasecraft"))).toBe('notBasecraft');
  expect(bcErrorCode(new Error('bc:exists'))).toBe('exists');
  expect(bcErrorCode(new Error("Error invoking remote method 'bc:base:open': Error: boom"))).toBeNull();
  expect(bcErrorCode('nothing')).toBeNull();
});
