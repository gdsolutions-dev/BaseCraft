import { describe, expect, it, vi } from 'vitest';
import type { DocMode } from '../state/app-state';
import { leaveFormDesign } from './FormDesignView';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The form designer's mode guard (L2): Design <-> Layout is one editor, nothing to ask; any other view asks a modified design.
const guard = (mode: DocMode, dirty: boolean, answer: 'yes' | 'no' | 'cancel' = 'no') => {
  const confirm = vi.fn(async () => answer);
  const save = vi.fn(async () => true);
  const flush = vi.fn(async () => {});
  return { confirm, save, flush, d: { mode, name: 'F', busy: false, flush, dirty: () => dirty, confirm, save } };
};

describe('leaveFormDesign', () => {
  it('Design -> Layout and Layout -> Design: true at once, nothing asked, nothing flushed, even modified', async () => {
    for (const [from, to] of [['design', 'layout'], ['layout', 'design']] as const) {
      const g = guard(from, true);
      expect(await leaveFormDesign('mode', to, g.d)).toBe(true);
      expect(g.confirm).not.toHaveBeenCalled();
      expect(g.flush).not.toHaveBeenCalled();
    }
  });

  it('to Form or Datasheet view, from Design or Layout view: a modified design is asked (Yes saves, No stays)', async () => {
    for (const from of ['design', 'layout'] as const) {
      for (const to of ['run', 'datasheet'] as const) {
        const no = guard(from, true, 'no');
        expect(await leaveFormDesign('mode', to, no.d)).toBe(false);
        expect(no.confirm).toHaveBeenCalledOnce();
        const yes = guard(from, true, 'yes');
        expect(await leaveFormDesign('mode', to, yes.d)).toBe(true);
        expect(yes.save).toHaveBeenCalledOnce();
      }
    }
    const clean = guard('layout', false);
    expect(await leaveFormDesign('mode', 'run', clean.d)).toBe(true);
    expect(clean.confirm).not.toHaveBeenCalled();
  });

  it('closing still asks a modified design (No discards); a save under way refuses, except Design <-> Layout', async () => {
    const g = guard('layout', true, 'no');
    expect(await leaveFormDesign('close', undefined, g.d)).toBe(true);
    expect(g.confirm).toHaveBeenCalledOnce();
    expect(await leaveFormDesign('close', undefined, { ...guard('design', true, 'cancel').d })).toBe(false);
    expect(await leaveFormDesign('mode', 'layout', { ...guard('design', true).d, busy: true })).toBe(true);
    expect(await leaveFormDesign('mode', 'design', { ...guard('layout', true).d, busy: true })).toBe(true);
    expect(await leaveFormDesign('mode', 'run', { ...guard('layout', true).d, busy: true })).toBe(false);
    expect(await leaveFormDesign('close', undefined, { ...guard('layout', true).d, busy: true })).toBe(false);
  });
});
