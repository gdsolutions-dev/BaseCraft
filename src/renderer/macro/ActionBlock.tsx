// Les blocs du concepteur de macros : une action et ses arguments, Commentaire, Groupe, Si / Sinon si / Sinon, Sous-macro, et
// « Ajouter une nouvelle action » au bout de chaque liste. Une action inconnue montre ses arguments en lecture seule.
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { sameName } from '../../shared/field-types';
import { actionDef } from '../../shared/macro/catalog';
import { submacroNames, type MacroDef, type MacroItem } from '../../shared/macro/model';
import { ComboBox } from '../shell/ComboBox';
import { ArgEditor, ExprInput, type MacroViewCtx } from './ArgEditor';
import { addableActions, pathKey, type ItemPath, type MacroEditState } from './macro-edit';

export interface BlockCtx extends MacroViewCtx { state: MacroEditState }

/** Access's Program Flow: the blocks « Ajouter une nouvelle action » and the Action Catalog offer before the actions. */
export const BLOCKS = ['comment', 'group', 'if', 'submacro'] as const;

/** The first free `Sub<n>` among the macro's submacros. */
function newSubmacroName(def: MacroDef, label: (n: number) => string): string {
  const taken = submacroNames(def);
  for (let n = 1; ; n++) if (!taken.some((x) => sameName(x, label(n)))) return label(n);
}

/** The item an option adds: `block-<b>` (a block, empty) or an action's name (no arguments). */
export function newItem(optId: string, def: MacroDef, t: TFunction): MacroItem {
  switch (optId) {
    case 'block-comment': return { k: 'comment', text: '' };
    case 'block-group': return { k: 'group', name: '', items: [] };
    case 'block-if': return { k: 'if', branches: [{ cond: '', items: [] }] };
    case 'block-submacro': return { k: 'submacro', name: newSubmacroName(def, (n) => t('macro.newSubmacro', { n })), items: [] };
    default: return { k: 'action', action: optId, args: {} };
  }
}

/** « Ajouter une nouvelle action »: the blocks, then the actions by label; the item goes at the end of the list `lp`. */
function AddItem({ lp, count, ctx }: { lp: ItemPath; count: number; ctx: BlockCtx }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const id = `macro-add-${pathKey(lp)}`;
  const options = [...BLOCKS.map((b) => ({ id: `block-${b}`, label: t(`macro.block.${b}`) })),
    ...addableActions(ctx.state.showAll).map((a) => ({ id: a.name, label: t(`macro.action.${a.name}`) }))];
  return (
    <div className="macro-add">
      <label htmlFor={id} className="sr-only">{t('macro.addAction')}</label>
      <ComboBox id={id} testId={id} label={t('macro.addAction')} value={text} options={options} disabled={ctx.readOnly}
        onChange={(v) => {
          const o = options.find((x) => x.label === v);
          if (!o) { setText(v); return; }
          setText('');
          ctx.send({ type: 'add', at: [...lp, count], item: newItem(o.id, ctx.state.def, t) });
        }} />
    </div>
  );
}

export function ItemList({ items, lp, ctx }: { items: MacroItem[]; lp: ItemPath; ctx: BlockCtx }) {
  return (
    <div className="macro-list">
      {items.map((it, i) => <ItemBlock key={i} item={it} path={[...lp, i]} ctx={ctx} />)}
      <AddItem lp={lp} count={items.length} ctx={ctx} />
    </div>
  );
}

function ItemBlock({ item, path, ctx }: { item: MacroItem; path: ItemPath; ctx: BlockCtx }) {
  const { t } = useTranslation();
  const key = pathKey(path);
  const { state: s, send, readOnly } = ctx;
  const selected = !!s.selected && pathKey(s.selected) === key;
  const collapsed = s.collapsed.has(key);
  const known = item.k === 'action' ? actionDef(item.action) : undefined;
  const tool = (testId: string, label: string, icon: ReactNode, onClick: () => void) => (
    <button type="button" className="iconbtn" data-testid={`${testId}-${key}`} aria-label={label} title={label} disabled={readOnly}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
  );
  const nameInput = (testId: string) => item.k === 'group' || item.k === 'submacro' ? (
    <input data-testid={`${testId}-${key}`} aria-label={t(`macro.block.${item.k}`)} disabled={readOnly} spellCheck={false} value={item.name}
      onChange={(e) => send({ type: 'setText', path, text: e.target.value })} />
  ) : null;

  let title: ReactNode, body: ReactNode = null;
  switch (item.k) {
    case 'action':
      title = known ? t(`macro.action.${item.action}`) : t('macro.unknownAction', { name: item.action });
      body = known
        ? known.args.map((a) => (
          <div key={a.name} className="macro-arg" data-testid={`macro-arg-${key}-${a.name}`}>
            <label htmlFor={`macro-arg-${key}-${a.name}-input`}>{t(`macro.arg.${a.name}`)}</label>
            <ArgEditor path={path} action={item.action} def={a} args={item.args} ctx={ctx} />
          </div>))
        : Object.entries(item.args).map(([name, v]) => (   // not ours: shown as stored, kept as is (Review Focus 5)
          <div key={name} className="macro-arg" data-testid={`macro-arg-${key}-${name}`}>
            <label htmlFor={`macro-arg-${key}-${name}-input`}>{name}</label>
            <input id={`macro-arg-${key}-${name}-input`} readOnly value={v} />
          </div>));
      break;
    case 'comment':
      title = t('macro.block.comment');
      body = <textarea data-testid={`macro-comment-${key}`} aria-label={t('macro.block.comment')} disabled={readOnly} rows={2} value={item.text}
        onChange={(e) => send({ type: 'setText', path, text: e.target.value })} />;
      break;
    case 'group': case 'submacro':
      title = <>{t(`macro.block.${item.k}`)} {nameInput(item.k === 'group' ? 'macro-group' : 'macro-sub')}</>;
      body = <ItemList items={item.items} lp={path} ctx={ctx} />;
      break;
    case 'if':
      title = t('macro.block.if');
      body = (
        <>
          {item.branches.map((b, j) => (
            <div key={j} className="macro-branch">
              <div className={`macro-branch-head${s.selected && pathKey(s.selected) === pathKey([...path, j]) ? ' is-selected' : ''}`}
                data-testid={`macro-branch-${key}-${j}`} tabIndex={0}
                onClick={(e) => { e.stopPropagation(); send({ type: 'select', path: [...path, j] }); }}>
                <span>{t(j === 0 ? 'macro.block.if' : 'macro.block.elseIf')}</span>
                <ExprInput id={`macro-if-${key}-${j}`} testId={`macro-if-${key}-${j}`} value={b.cond || undefined} ctx={ctx}
                  label={t(j === 0 ? 'macro.block.if' : 'macro.block.elseIf')}
                  onCommit={(c) => send({ type: 'setCondition', path, branch: j, cond: c ?? '' })} />
              </div>
              <ItemList items={b.items} lp={[...path, j]} ctx={ctx} />
            </div>
          ))}
          {item.else && (
            <div className="macro-branch">
              <div className={`macro-branch-head${s.selected && pathKey(s.selected) === pathKey([...path, -1]) ? ' is-selected' : ''}`}
                data-testid={`macro-branch-${key}--1`} tabIndex={0}
                onClick={(e) => { e.stopPropagation(); send({ type: 'select', path: [...path, -1] }); }}>{t('macro.block.else')}</div>
              <ItemList items={item.else} lp={[...path, -1]} ctx={ctx} />
            </div>
          )}
          <div className="macro-if-tools">
            <button type="button" className="macro-link" data-testid={`macro-if-${key}-addElseIf`} disabled={readOnly}
              onClick={() => send({ type: 'addElseIf', path })}>{t('macro.addElseIf')}</button>
            {!item.else && <button type="button" className="macro-link" data-testid={`macro-if-${key}-addElse`} disabled={readOnly}
              onClick={() => send({ type: 'addElse', path })}>{t('macro.addElse')}</button>}
          </div>
        </>
      );
      break;
  }

  return (
    <div className={`macro-block macro-${item.k}${selected ? ' is-selected' : ''}`} data-testid={`macro-item-${key}`} tabIndex={0}
      onClick={(e) => { e.stopPropagation(); send({ type: 'select', path }); }}>
      <div className="macro-head">
        {item.k !== 'comment' && (
          <button type="button" className="iconbtn" data-testid={`macro-collapse-${key}`} aria-expanded={!collapsed}
            aria-label={t(collapsed ? 'macro.expand' : 'macro.collapse')} title={t(collapsed ? 'macro.expand' : 'macro.collapse')}
            onClick={(e) => { e.stopPropagation(); send({ type: 'collapse', path, on: !collapsed }); }}>
            {collapsed ? <ChevronRight className="ic ic-sm" aria-hidden /> : <ChevronDown className="ic ic-sm" aria-hidden />}
          </button>
        )}
        <span className="macro-title">{title}</span>
        {selected && (
          <span className="macro-tools">
            {tool('macro-up', t('macro.moveUp'), <ArrowUp className="ic ic-sm" aria-hidden />, () => send({ type: 'move', path, dir: -1 }))}
            {tool('macro-down', t('macro.moveDown'), <ArrowDown className="ic ic-sm" aria-hidden />, () => send({ type: 'move', path, dir: 1 }))}
            {tool('macro-remove', t('macro.remove'), <X className="ic ic-sm" aria-hidden />, () => send({ type: 'remove', path }))}
          </span>
        )}
      </div>
      {!collapsed && body && <div className="macro-body">{body}</div>}
    </div>
  );
}
