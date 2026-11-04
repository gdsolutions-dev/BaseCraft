import { describe, expect, it, vi } from 'vitest';
import type { DocMode } from '../state/app-state';
import { leaveReportDesign } from './design/ReportDesignView';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The report designer's mode guard (L3): Design <-> Layout is one editor, nothing to ask; Print Preview and State run the report as it
// stands, unsaved (as a query); closing asks a modified design.
const guard = (mode: DocMode, dirty: boolean, answer: 'yes' | 'no' | 'cancel' = 'no', o: { busy?: boolean; isNew?: boolean } = {}) => {
  const confirm = vi.fn(async () => answer);
  const save = vi.fn(async () => true);
  const flush = vi.fn(async () => {});
  const unsaved = vi.fn();
  return { confirm, save, flush, unsaved, d: { mode, name: 'R', busy: o.busy ?? false, isNew: o.isNew ?? false, flush, dirty: () => dirty, confirm, save, unsaved } };
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

  it('to Print Preview or State, from Design or Layout view: nothing asked, nothing saved; the report runs as it stands when modified or new', async () => {
    for (const from of ['design', 'layout'] as const) {
      for (const to of ['run', 'state'] as const) {
        const modified = guard(from, true);
        expect(await leaveReportDesign('mode', to, modified.d)).toBe(true);
        expect([modified.confirm.mock.calls.length, modified.save.mock.calls.length]).toEqual([0, 0]);
        expect(modified.unsaved).toHaveBeenCalledWith(true);
        const fresh = guard(from, false, 'cancel', { isNew: true });
        expect(await leaveReportDesign('mode', to, fresh.d)).toBe(true);
        expect([fresh.confirm.mock.calls.length, fresh.save.mock.calls.length, fresh.unsaved.mock.calls[0]]).toEqual([0, 0, [true]]);
        const clean = guard(from, false);
        expect(await leaveReportDesign('mode', to, clean.d)).toBe(true);
        expect(clean.unsaved).toHaveBeenCalledWith(false);
      }
    }
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
