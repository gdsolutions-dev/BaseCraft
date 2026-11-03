import { describe, expect, it, vi } from 'vitest';
import type { DocMode } from '../state/app-state';
import { leaveReportDesign } from './design/ReportDesignView';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The report designer's mode guard (L3): Design <-> Layout is one editor, nothing to ask; Print Preview and closing ask a modified design.
const guard = (mode: DocMode, dirty: boolean, answer: 'yes' | 'no' | 'cancel' = 'no', o: { busy?: boolean; isNew?: boolean } = {}) => {
  const confirm = vi.fn(async () => answer);
  const save = vi.fn(async () => true);
  const flush = vi.fn(async () => {});
  return { confirm, save, flush, d: { mode, name: 'R', busy: o.busy ?? false, isNew: o.isNew ?? false, flush, dirty: () => dirty, confirm, save } };
};

describe('leaveReportDesign', () => {
  it('Design -> Layout and Layout -> Design: true at once, nothing asked nor flushed, even modified, new or during a save', async () => {
    for (const [from, to] of [['design', 'layout'], ['layout', 'design']] as const) {
      for (const o of [{}, { busy: true }, { isNew: true }]) {
        const g = guard(from, true, 'cancel', o);
        expect(await leaveReportDesign('mode', to, g.d)).toBe(true);
        expect(g.confirm).not.toHaveBeenCalled();
        expect(g.flush).not.toHaveBeenCalled();
        expect(g.save).not.toHaveBeenCalled();
      }
    }
  });

  it('to Print Preview, from Design or Layout view: a modified design is asked (Yes saves, No goes on, Cancel stays); a clean one is not', async () => {
    for (const from of ['design', 'layout'] as const) {
      const yes = guard(from, true, 'yes');
      expect(await leaveReportDesign('mode', 'run', yes.d)).toBe(true);
      expect([yes.confirm.mock.calls.length, yes.save.mock.calls.length]).toEqual([1, 1]);
      expect(await leaveReportDesign('mode', 'run', guard(from, true, 'no').d)).toBe(true);
      expect(await leaveReportDesign('mode', 'run', guard(from, true, 'cancel').d)).toBe(false);
      const clean = guard(from, false);
      expect(await leaveReportDesign('mode', 'run', clean.d)).toBe(true);
      expect(clean.confirm).not.toHaveBeenCalled();
    }
    const fresh = guard('layout', false, 'cancel', { isNew: true });   // a new report is saved first
    expect(await leaveReportDesign('mode', 'run', fresh.d)).toBe(true);
    expect([fresh.confirm.mock.calls.length, fresh.save.mock.calls.length]).toEqual([0, 1]);
  });

  it('a save under way refuses Print Preview and closing; closing asks a modified design', async () => {
    expect(await leaveReportDesign('mode', 'run', guard('layout', true, 'yes', { busy: true }).d)).toBe(false);
    expect(await leaveReportDesign('close', undefined, guard('design', false, 'yes', { busy: true }).d)).toBe(false);
    const g = guard('layout', true, 'no');
    expect(await leaveReportDesign('close', undefined, g.d)).toBe(true);
    expect(g.confirm).toHaveBeenCalledOnce();
    expect(await leaveReportDesign('close', undefined, guard('design', true, 'cancel').d)).toBe(false);
  });
});
