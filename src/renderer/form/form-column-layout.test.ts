import { describe, expect, it, vi } from 'vitest';
import { leaveSheetLayout } from './FormRunView';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The datasheet's dragged column widths on leaving the tab (Access's "save changes to the layout?").
const run = (widths: Record<string, number>, over: { ro?: boolean; answer?: 'yes' | 'no' | 'cancel'; saved?: boolean } = {}) => {
  const confirm = vi.fn(async () => over.answer ?? 'no');
  const save = vi.fn(async () => over.saved ?? true);
  return { confirm, save, go: () => leaveSheetLayout({ widths, readOnly: over.ro ?? false, name: 'F', confirm, save }) };
};

describe('leaveSheetLayout', () => {
  it('nothing dragged, or a read-only base: leaves at once, nothing asked or saved', async () => {
    for (const r of [run({}), run({ A: 90 }, { ro: true })]) {
      expect(await r.go()).toBe(true);
      expect(r.confirm).not.toHaveBeenCalled();
      expect(r.save).not.toHaveBeenCalled();
    }
  });
  it('Yes saves the widths and leaves; a failed save stays', async () => {
    const ok = run({ A: 90 }, { answer: 'yes' });
    expect(await ok.go()).toBe(true);
    expect(ok.save).toHaveBeenCalledWith({ A: 90 });
    expect(ok.confirm).toHaveBeenCalledWith(expect.objectContaining({ titleKey: 'form.saveFirstTitle', messageKey: 'form.saveLayout', params: { name: 'F' }, buttons: ['yes', 'no', 'cancel'] }));
    expect(await run({ A: 90 }, { answer: 'yes', saved: false }).go()).toBe(false);
  });
  it('messageKey replaces the form text', async () => {
    const confirm = vi.fn(async () => 'no' as const);
    await leaveSheetLayout({ widths: { A: 90 }, readOnly: false, name: 'T', messageKey: 'datasheet.saveTableLayout', confirm, save: async () => true });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ messageKey: 'datasheet.saveTableLayout' }));
  });
  it('No leaves without saving; Cancel stays without saving', async () => {
    const no = run({ A: 90 }, { answer: 'no' });
    expect(await no.go()).toBe(true);
    expect(no.save).not.toHaveBeenCalled();
    const c = run({ A: 90 }, { answer: 'cancel' });
    expect(await c.go()).toBe(false);
    expect(c.save).not.toHaveBeenCalled();
  });
  describe('with subforms (others)', () => {
    const sub = (dirty: boolean, saved = true) => ({ dirty, save: vi.fn(async () => saved), drop: vi.fn() });
    const go = (widths: Record<string, number>, others: ReturnType<typeof sub>, answer: 'yes' | 'no' | 'cancel') => {
      const confirm = vi.fn(async () => answer);
      const save = vi.fn(async () => true);
      return { confirm, save, r: leaveSheetLayout({ widths, readOnly: false, name: 'F', confirm, save, others }) };
    };
    it('nothing dragged anywhere: not asked', async () => {
      const o = sub(false);
      const x = go({}, o, 'yes');
      expect(await x.r).toBe(true);
      expect(x.confirm).not.toHaveBeenCalled();
    });
    it('own widths empty but a subform dirty: asked; Yes saves own (none) then the subforms', async () => {
      const o = sub(true);
      const x = go({}, o, 'yes');
      expect(await x.r).toBe(true);
      expect(x.confirm).toHaveBeenCalled();
      expect(x.save).not.toHaveBeenCalled();
      expect(o.save).toHaveBeenCalled();
    });
    it('Yes with own widths: own save, then the subforms; a failed subform save stays', async () => {
      const x = go({ A: 90 }, sub(true, false), 'yes');
      expect(await x.r).toBe(false);
      expect(x.save).toHaveBeenCalledWith({ A: 90 });
    });
    it('No drops the subforms; Cancel does neither', async () => {
      const o = sub(true);
      expect(await go({}, o, 'no').r).toBe(true);
      expect(o.drop).toHaveBeenCalled();
      const c = sub(true);
      expect(await go({}, c, 'cancel').r).toBe(false);
      expect(c.drop).not.toHaveBeenCalled();
      expect(c.save).not.toHaveBeenCalled();
    });
  });
});
