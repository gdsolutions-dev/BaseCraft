// Mode SQL d'une requête, comme dans Access : un éditeur de texte à chasse fixe qui tient le SQL canonique (printSql), jamais
// traduit (spec 4.5). Une erreur de lecture s'affiche sous l'éditeur et sa plage est sélectionnée.
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { Annotation, Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Span } from '../../shared/expr/ast';
import { exprErrorText } from '../expr/error-text';
import { complete, highlight, wordAt } from './sql-highlight';

/** The tolerant colouring pass of sql-highlight as marks (the parser's lexer throws on half-typed text). */
const colours = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = this.build(v); }
  update(u: { docChanged: boolean; view: EditorView }) { if (u.docChanged) this.decorations = this.build(u.view); }
  build(v: EditorView) {
    const b = new RangeSetBuilder<Decoration>();
    let at = 0;
    for (const r of highlight(v.state.doc.toString())) {
      if (r.kind !== 'text') b.add(at, at + r.text.length, Decoration.mark({ class: `sql-${r.kind}` }));
      at += r.text.length;
    }
    return b.finish();
  }
}, { decorations: (p) => p.decorations });

const editable = new Compartment();
const external = Annotation.define<boolean>();   // the text came from the props: not a user edit

interface Props {
  sql: string;
  onChange(sql: string): void;
  error: { code: string; span: Span } | null;
  /** A note under the editor (only SQL view can show this query). */
  notice?: string | null;
  readOnly?: boolean;
  /** Tables, queries and fields offered by the autocompletion (with the SQL keywords). */
  names?: readonly string[];
  /** The Format command (absent: not offered). */
  onFormat?(): void;
}

export function SqlView({ sql, onChange, error, notice, readOnly, names = [], onFormat }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const errorId = useId(); // tabs stay mounted: one id per view
  const live = useRef({ onChange, names, label: t('ribbon.cmd.viewSql'), errorId });
  live.current = { onChange, names, label: t('ribbon.cmd.viewSql'), errorId };
  useEffect(() => {
    // keywords, tables, queries, fields: the word before the caret (a `[name` too), as the Ctrl+Space of Access
    const source = (ctx: CompletionContext) => {
      const w = wordAt(ctx.state.doc.sliceString(0, ctx.pos), ctx.pos);
      const items = w ? complete(w.word, live.current.names, 12) : [];
      return w && items.length ? { from: w.start, options: items.map((label) => ({ label })), filter: false } : null;
    };
    const ev = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: sql, extensions: [minimalSetup, editable.of(EditorView.editable.of(!readOnly)), colours, autocompletion({ override: [source] }),
        EditorView.contentAttributes.of(() => ({ 'data-testid': 'query-sql', 'aria-label': live.current.label, spellcheck: 'false' })),
        EditorView.updateListener.of((u) => { if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) live.current.onChange(u.state.doc.toString()); })] }),
    });
    view.current = ev;
    return () => ev.destroy();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- one editor per view; props reach it through `live` and the effects below
  useEffect(() => {   // the text and read-only state follow the props
    const ev = view.current;
    if (!ev) return;
    if (ev.state.doc.toString() !== sql) ev.dispatch({ changes: { from: 0, to: ev.state.doc.length, insert: sql }, annotations: external.of(true) });
  }, [sql]);
  useEffect(() => { view.current?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) }); }, [readOnly]);
  useEffect(() => {
    const ev = view.current;
    if (!ev) return;
    if (error) ev.contentDOM.setAttribute('aria-invalid', 'true'), ev.contentDOM.setAttribute('aria-describedby', errorId);
    else ev.contentDOM.removeAttribute('aria-invalid'), ev.contentDOM.removeAttribute('aria-describedby');
  }, [error, errorId]);
  // a new error selects its range, as Access selects the faulty word
  useEffect(() => {
    const ev = view.current;
    if (!ev || !error) return;
    const n = ev.state.doc.length;
    ev.focus();
    ev.dispatch({ selection: { anchor: Math.min(error.span.start, n), head: Math.min(Math.max(error.span.start, error.span.end), n) } });
  }, [error]);
  return (
    <div className="qd-sql">
      {onFormat && <div className="qd-sql-bar"><button className="btn" data-testid="query-sql-format" disabled={readOnly || !sql.trim()} onClick={onFormat}>{t('query.sqlFormat')}</button></div>}
      <div className="qd-sql-edit" ref={host} />
      {error && (
        <p id={errorId} className="modal-error" role="alert" data-testid="query-sql-error">
          {error.code.startsWith('pythonNotAllowed:') ? exprErrorText(t, error.code) : t([`query.error.${error.code}`, `expr.error.${error.code}`])}
        </p>
      )}
      {notice && <p className="muted" data-testid="query-sql-notice">{notice}</p>}
    </div>
  );
}
