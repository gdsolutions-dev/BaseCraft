import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DocKind, DocMode } from '../state/app-state';
import { DocumentView, hasDocumentView, UnavailableView } from './document-views';
import '../design/entry';

vi.mock('../bridge', () => ({ api: {} }));
vi.mock('../datasheet/glide-keyboard', () => ({ installEditorCommitFix: () => {} })); // node, no DOM

// The component a tab's view renders (DocumentView uses no hook: called as a function, it returns the element of its view).
const view = (kind: DocKind, mode: DocMode) =>
  (DocumentView({ tab: { id: 't', kind, name: 'X', mode, dirty: false, reloadToken: 0 }, active: true, readOnly: false, dispatch: () => {} } as never) as ReactElement).type;

describe('document views (L2)', () => {
  it('a form\'s Layout view is its Design view\'s component: Design <-> Layout never remounts', () => {
    expect(hasDocumentView('form', 'layout')).toBe(true);
    expect(view('form', 'layout')).toBe(view('form', 'design'));
    expect(view('form', 'layout')).not.toBe(UnavailableView);
    expect(view('form', 'run')).not.toBe(view('form', 'design'));
    expect(view('form', 'datasheet')).toBe(view('form', 'run'));
  });

  it("L3: a report's Layout view is its Design view's component; Print Preview is another", () => {
    expect(hasDocumentView('report', 'layout')).toBe(true);
    expect(view('report', 'layout')).toBe(view('report', 'design'));
    expect(view('report', 'layout')).not.toBe(UnavailableView);
    expect(view('report', 'run')).not.toBe(view('report', 'design'));
  });

  it('tables, queries and macros offer no Layout view', () => {
    for (const kind of ['table', 'query', 'macro'] as const) expect(hasDocumentView(kind, 'layout')).toBe(false);
  });
});
