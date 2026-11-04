import { Children, Fragment, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DocKind, DocMode } from '../state/app-state';
import { DocumentView, hasDocumentView, UnavailableView } from './document-views';
import '../design/entry';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The components a tab's view renders (DocumentView uses no hook: called as a function, it returns its element, or a fragment of
// the sections shown: a form or report keeps its design behind its run view while unsaved, or the Design view alone).
const view = (kind: DocKind, mode: DocMode, isNew = false): unknown[] => {
  const el = DocumentView({ tab: { id: 't', kind, name: 'X', mode, dirty: false, reloadToken: 0, isNew }, active: true, readOnly: false, dispatch: () => {} } as never) as ReactElement;
  if (el.type !== Fragment) return [el.type];
  return (Children.toArray(el.props.children) as ReactElement[]).map((s) => (Children.toArray(s.props.children) as ReactElement[])[0]!.type);
};

describe('document views (L2)', () => {
  it('a dialog form stays shown when another tab is active (a Python error opens its module); a background tab does not', () => {
    const hidden = (dialog: boolean) => {
      const tab = { id: 't', kind: 'form', name: 'X', mode: 'run', dirty: false, reloadToken: 0, ...(dialog ? { dialog: true } : {}) };
      const el = DocumentView({ tab, active: false, readOnly: false, dispatch: () => {} } as never) as ReactElement;
      return (Children.toArray(el.props.children) as ReactElement[]).map((s) => s.props.hidden);
    };
    expect(hidden(true)).toEqual([false]);
    expect(hidden(false)).toEqual([true]);
  });

  it('a form\'s Layout view is its Design view\'s component: Design <-> Layout never remounts', () => {
    expect(hasDocumentView('form', 'layout')).toBe(true);
    expect(view('form', 'layout')).toEqual(view('form', 'design'));
    expect(view('form', 'layout')).not.toContain(UnavailableView);
    expect(view('form', 'run')).not.toEqual(view('form', 'design'));
    expect(view('form', 'datasheet')).toEqual(view('form', 'run'));
    // a new form: its design stays behind its Form view (it runs unsaved, as a query), and comes back at a close
    expect(view('form', 'run', true)).toEqual([view('form', 'design')[0], view('form', 'run')[0]]);
  });

  it("L3: a report's Layout view is its Design view's component; Print Preview is another", () => {
    expect(hasDocumentView('report', 'layout')).toBe(true);
    expect(view('report', 'layout')).toEqual(view('report', 'design'));
    expect(view('report', 'layout')).not.toContain(UnavailableView);
    expect(view('report', 'run')).not.toEqual(view('report', 'design'));
    expect(view('report', 'state', true)).toEqual([view('report', 'design')[0], view('report', 'state')[0]]);
  });

  it('tables, queries and macros offer no Layout view', () => {
    for (const kind of ['table', 'query', 'macro'] as const) expect(hasDocumentView(kind, 'layout')).toBe(false);
  });
});
