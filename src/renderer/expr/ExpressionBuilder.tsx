// Générateur d'expressions, comme celui d'Access : la zone de saisie (forme affichée), trois listes (éléments, catégories,
// valeurs) dont un double-clic ou Entrée insère la valeur au curseur, et la description de la fonction choisie. OK contrôle
// le texte : refusé, le message s'affiche et la partie fautive est sélectionnée ; accepté, la forme canonique est rendue.
// S'ouvre par useModal().custom : la boîte garde le focus (Tab entre les zones) et Échap annule.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Span } from '../../shared/expr/ast';
import { categories, check, elements, insertAt, items, type BuilderContext, type BuilderElement } from './builder-model';
import './expression-builder.css';

interface Props {
  ctx: BuilderContext;
  initial: string; // display form
  label?: string;
  close(canonical: string | null): void;
  /** After `check`: the base's refusal (a filter criterion), as a message; the builder then stays open with the text. */
  validate?(canonical: string): Promise<string | null>;
}

export function ExpressionBuilder({ ctx, initial, label, close, validate }: Props) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [select, setSelect] = useState<Span | null>(null); // applied, with the focus, once rendered
  const [el, setEl] = useState<BuilderElement>('functions');
  const [cat, setCat] = useState('all');
  const [pick, setPick] = useState('');
  const list = items(el, cat, ctx);
  const chosen = list[Number(pick)];

  // The caret at the end; the dialog gives the focus (and takes it back to where it was when it closes).
  useLayoutEffect(() => area.current?.setSelectionRange(initial.length, initial.length), []);
  useLayoutEffect(() => {
    if (!select) return;
    area.current?.focus();
    area.current?.setSelectionRange(select.start, select.end);
    setSelect(null);
  }, [select]);

  /** Replaces the expression's selection (a placeholder) by the value; a function's first placeholder is then selected. */
  const insert = (index: string) => {
    const item = list[Number(index)];
    const a = area.current;
    if (!item || !a || index === '') return;
    const r = insertAt(text.slice(0, a.selectionStart) + text.slice(a.selectionEnd), a.selectionStart, item.snippet);
    setText(r.text);
    setError(null);
    setSelect({ start: r.caret, end: r.text[r.caret] === '«' ? r.text.indexOf('»', r.caret) + 1 : r.caret });
  };

  const ok = async () => {
    const r = check(text, ctx);
    if (!r.ok) {
      setError(t(`expr.error.${r.code}`));
      setSelect(r.span);
      return;
    }
    const refused = validate ? await validate(r.canonical) : null;
    // Gone at once, even after the await: what the caller does next (a filter focusing its grid) sees no dialog left.
    if (refused === null) flushSync(() => close(r.canonical));
    else { setError(refused); setSelect({ start: 0, end: text.length }); }
  };

  const onListKey = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    insert(e.currentTarget.value);
  };
  const catLabel = (c: string) => (c === 'all' ? t('builder.all') : t(el === 'functions' ? `expr.cat.${c}` : `builder.op.${c}`));

  return (
    <div className="xb">
      <label className="xb-field">
        <span>{label ?? t('builder.expression')}</span>
        <textarea ref={area} data-testid="xb-text" rows={3} spellCheck={false} value={text} aria-invalid={error !== null}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ok(); } }} />
      </label>
      {error && <div className="modal-error" role="alert" data-testid="xb-error">{error}</div>}
      <div className="xb-lists">
        <label className="xb-list">
          <span>{t('builder.elements')}</span>
          <select size={8} data-testid="xb-elements" value={el} onChange={(e) => { setEl(e.target.value as BuilderElement); setCat('all'); setPick(''); }}>
            {elements(ctx).map((x) => <option key={x} value={x} data-testid={`xb-el-${x}`}>{t(`builder.el.${x}`)}</option>)}
          </select>
        </label>
        <label className="xb-list">
          <span>{t('builder.categories')}</span>
          <select size={8} data-testid="xb-categories" value={cat} onChange={(e) => { setCat(e.target.value); setPick(''); }}>
            {categories(el).map((c) => <option key={c} value={c} data-testid={`xb-cat-${c}`}>{catLabel(c)}</option>)}
          </select>
        </label>
        <label className="xb-list">
          <span>{t('builder.values')}</span>
          <select size={8} data-testid="xb-values" value={pick} onChange={(e) => setPick(e.target.value)}
            onDoubleClick={(e) => insert(e.currentTarget.value)} onKeyDown={onListKey}>
            {list.map((x, i) => <option key={x.label} value={String(i)} data-testid={`xb-val-${x.label}`}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <p className="xb-desc" data-testid="xb-desc" aria-live="polite">
        {chosen?.fn && <><code>{chosen.snippet}</code> {t(`expr.fn.${chosen.fn}`)}</>}
      </p>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="xb-ok" onClick={() => void ok()}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="xb-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
