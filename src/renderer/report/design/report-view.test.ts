import { describe, expect, it, vi } from 'vitest';
import { catalogs } from '../../../shared/i18n/catalogs';
import { UI_LANGUAGES } from '../../../shared/i18n';
import { REPORT_LAYOUT_RESTRICT } from '../../designer/designer-restrict';
import type { FlowNotice } from '../layout-flow';
import { previewFromDesign, takePreviewReturn } from '../ReportPreviewView';
import { layoutNoticeKey, reportView } from './report-view';

vi.mock('../../bridge', () => ({ api: {} }));
vi.mock('../../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

const get = (o: unknown, k: string): unknown => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);

describe('reportView (L3)', () => {
  it('Layout view: the flow canvas and the restricted gestures (toolbox available; no section bars, no Event tab)', () => {
    expect(reportView('layout')).toEqual({ canvas: 'flow', restrict: REPORT_LAYOUT_RESTRICT });
    expect(REPORT_LAYOUT_RESTRICT).toEqual({ toolbox: false, sectionBars: true, events: true });
  });
  it('Design view: the design canvas, nothing restricted (no canvas, no restrict passed)', () => {
    expect(reportView('design')).toEqual({ canvas: 'design', restrict: undefined });
  });
});

describe('layoutNoticeKey (L3)', () => {
  const all: FlowNotice[] = ['noSource', 'empty', 'unreadable', 'parameters', 'truncated', 'layoutFailed'];
  it('every notice has a report text in all 11 languages; truncated keeps its {{count}}', () => {
    for (const n of all) {
      const key = layoutNoticeKey(n, false)!;
      expect(key, n).toMatch(/^layoutView\.notice\./);
      for (const l of UI_LANGUAGES) expect(typeof get(catalogs[l], key), `${l} ${key}`).toBe('string');
    }
    expect(layoutNoticeKey('truncated', false)).toBe('layoutView.notice.truncated');
    for (const l of UI_LANGUAGES) expect(get(catalogs[l], 'layoutView.notice.truncated'), l).toContain('{{count}}');
  });
  it('report texts, not the form ones ("this form")', () => {
    for (const n of ['noSource', 'empty', 'unreadable', 'parameters', 'layoutFailed'] as const) expect(layoutNoticeKey(n, false)).toBe(`layoutView.notice.report.${n}`);
    expect(get(catalogs.en, 'layoutView.notice.report.noSource')).toMatch(/report/);
    expect(get(catalogs.fr, 'layoutView.notice.report.noSource')).toMatch(/état/);
  });
  it('unreadable is not repeated under the source-error banner; the others still are; no notice gives none', () => {
    expect(layoutNoticeKey('unreadable', true)).toBeNull();
    expect(layoutNoticeKey('truncated', true)).toBe('layoutView.notice.truncated');
    expect(layoutNoticeKey('parameters', true)).toBe('layoutView.notice.report.parameters');
    expect(layoutNoticeKey('layoutFailed', true)).toBe('layoutView.notice.report.layoutFailed');   // the source was read: not the source's error
    expect(layoutNoticeKey(null, false)).toBeNull();
  });
});

describe('Close Preview returns to the view it was opened from (L3)', () => {
  it('Layout or Design, read once; a preview not opened from the designer has none (the tab closes)', () => {
    previewFromDesign.set('a', 'layout');
    previewFromDesign.set('b', 'design');
    expect(takePreviewReturn('a')).toBe('layout');
    expect(takePreviewReturn('a')).toBeUndefined();
    expect(takePreviewReturn('b')).toBe('design');
    expect(takePreviewReturn('c')).toBeUndefined();
  });
  it('Layout view no longer allowed (AllowLayoutView = false saved): back to Design view', () => {
    previewFromDesign.set('a', 'layout');
    previewFromDesign.set('b', 'design');
    expect(takePreviewReturn('a', false)).toBe('design');
    expect(takePreviewReturn('b', false)).toBe('design');
    expect(takePreviewReturn('c', false)).toBeUndefined();
  });
});
