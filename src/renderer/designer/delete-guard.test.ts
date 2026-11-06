import { describe, expect, it } from 'vitest';
import { deleteKeyAllowed } from './delete-guard';

const el = (tagName: string, inRibbon = false) => ({ tagName, closest: (s: string) => (inRibbon && s === '.ribbon' ? {} : null) }) as unknown as Element;

describe('deleteKeyAllowed', () => {
  it('allows body and ribbon buttons only', () => {
    expect(deleteKeyAllowed(el('BODY'))).toBe(true);
    expect(deleteKeyAllowed(el('BUTTON', true))).toBe(true);
    for (const [tag, ribbon] of [['SELECT', true], ['SELECT', false], ['BUTTON', false], ['INPUT', false], ['INPUT', true], ['DIV', false]] as const)
      expect(deleteKeyAllowed(el(tag, ribbon))).toBe(false);
  });
});
