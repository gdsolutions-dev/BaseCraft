// Le volet « Regrouper, trier et total » d'Access, sous la surface de création : une ligne par niveau (regrouper sur / trier par,
// champ ou expression, ordre, en-tête, pied, conserver ensemble, monter, descendre, supprimer), puis Ajouter un groupe / un tri.
// Chaque changement est une opération `edit` : annulable, et passée par le garde de la vue (sections qui ont des contrôles).
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc } from '../../../shared/design/model';
import type { DisplayContext } from '../../../shared/expr/localize';
import type { SourceField } from '../../../shared/record-source';
import type { GroupLevel } from '../../../shared/report/model';
import type { DesignerAction } from '../../designer/designer-model';
import { controlSourceToCanonical, controlSourceToDisplay } from '../../designer/property-sheet-model';
import { PopupMenu } from '../../designer/RibbonPopup';
import { ComboBox } from '../../shell/ComboBox';
import { addGroup, addSort, groupLevels, moveGroup, orderKind, removeGroup, setGroup } from './grouping-model';

const KEEP: GroupLevel['keepTogether'][] = ['no', 'wholeGroup', 'withFirstDetail'];
const ITEM_HEIGHT = 28;   // .ctxmenu button

interface Props { doc: DesignDoc; fields: SourceField[]; display: DisplayContext; readOnly: boolean; dispatch(a: DesignerAction): void; onClose(): void }

export function GroupingPane({ doc, fields: sourceFields, display, readOnly, dispatch, onClose }: Props) {
  const { t } = useTranslation();
  const fields = sourceFields.map((f) => f.name);
  const [picker, setPicker] = useState<{ sort: boolean; x: number; y: number } | null>(null);
  const levels = groupLevels(doc);
  const edit = (apply: (d: DesignDoc) => DesignDoc) => dispatch({ type: 'edit', apply });
  // Monter, Descendre, Supprimer : le focus suit le niveau déplacé, ou va à la ligne suivante (sinon « Ajouter un groupe »), une fois
  // l'opération faite (le garde peut demander d'abord ; un Non ne la fait jamais : `done` reste faux). Les niveaux gardent leur identité.
  const root = useRef<HTMLElement>(null);
  const pending = useRef<{ done(d: DesignDoc): boolean; focus: string[] } | null>(null);
  useEffect(() => {
    const p = pending.current;
    if (!p?.done(doc)) return;
    pending.current = null;
    const el = p.focus.map((id) => root.current?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)).find((b) => b && !b.disabled);
    el?.focus();
  }, [doc]);
  const move = (i: number, to: number) => {
    const level = levels[i], dir = to < i ? 'up' : 'down', back = to < i ? 'down' : 'up';
    pending.current = { done: (d) => groupLevels(d)[to] === level, focus: [`grouping-row-${to}-${dir}`, `grouping-row-${to}-${back}`] };
    edit((d) => moveGroup(d, i, to));
  };
  const remove = (i: number) => {
    const level = levels[i];
    pending.current = { done: (d) => !groupLevels(d).includes(level!), focus: [`grouping-row-${i}-delete`, 'grouping-add-group'] };
    edit((d) => removeGroup(d, i));
  };
  const set = (i: number, patch: Partial<GroupLevel>) => edit((d) => setGroup(d, i, patch));
  const openPicker = (sort: boolean, el: HTMLElement) => {
    const r = el.getBoundingClientRect(), h = fields.length * ITEM_HEIGHT + 10;   // au-dessus du bouton quand il n'y a pas la place dessous
    setPicker({ sort, x: r.left, y: r.bottom + h > innerHeight ? Math.max(4, r.top - h) : r.bottom });
  };
  const yesNo = (i: number, key: 'header' | 'footer', g: GroupLevel) => (
    <select data-testid={`grouping-row-${i}-${key}`} aria-label={t(`report.grouping.${key}`)} disabled={readOnly} value={String(g[key])}
      onChange={(e) => set(i, { [key]: e.target.value === 'true' })}>
      <option value="true">{t(`report.grouping.with${key === 'header' ? 'Header' : 'Footer'}`)}</option>
      <option value="false">{t(`report.grouping.without${key === 'header' ? 'Header' : 'Footer'}`)}</option>
    </select>
  );

  return (
    <section ref={root} className="rd-grouping" data-testid="grouping-pane" aria-label={t('report.grouping.title')}>
      <header className="rd-grouping-head">
        <span>{t('report.grouping.title')}</span>
        <button type="button" className="iconbtn" data-testid="grouping-close" aria-label={t('report.grouping.close')} title={t('report.grouping.close')} onClick={onClose}>
          <X className="ic ic-sm" aria-hidden />
        </button>
      </header>
      <div className="rd-grouping-rows">
        {levels.map((g, i) => (
          <div key={i} className="rd-grow" role="group" data-testid={`grouping-row-${i}`} aria-label={`${t(g.header || g.footer ? 'report.grouping.groupOn' : 'report.grouping.sortBy')} ${controlSourceToDisplay(g.expression, display)}`}>
            <span className="rd-gkind">{t(g.header || g.footer ? 'report.grouping.groupOn' : 'report.grouping.sortBy')}</span>
            <GroupExpression key={`${i}:${g.expression}`} id={`grouping-${i}-expr`} testId={`grouping-row-${i}-expression`} value={g.expression} fields={fields}
              display={display} disabled={readOnly} onCommit={(expression) => set(i, { expression })} />
            <select data-testid={`grouping-row-${i}-order`} aria-label={t('report.grouping.order')} disabled={readOnly} value={g.order}
              onChange={(e) => set(i, { order: e.target.value as GroupLevel['order'] })}>
              {(['asc', 'desc'] as const).map((o) => {
                const kind = orderKind(g.expression, sourceFields);   // « avec A en haut »… selon le type du champ (Access)
                return <option key={o} value={o}>{t(kind ? `report.grouping.orderBy.${kind}.${o}` : `report.grouping.${o}`)}</option>;
              })}
            </select>
            {yesNo(i, 'header', g)}
            {yesNo(i, 'footer', g)}
            <select data-testid={`grouping-row-${i}-keepTogether`} aria-label={t('report.grouping.keepTogether')} disabled={readOnly} value={g.keepTogether}
              onChange={(e) => set(i, { keepTogether: e.target.value as GroupLevel['keepTogether'] })}>
              {KEEP.map((k) => <option key={k} value={k}>{t(`report.grouping.keep.${k}`)}</option>)}
            </select>
            <span className="rd-gactions">
              <button type="button" className="iconbtn" data-testid={`grouping-row-${i}-up`} aria-label={t('report.grouping.moveUp')} title={t('report.grouping.moveUp')}
                disabled={readOnly || i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="ic ic-sm" aria-hidden /></button>
              <button type="button" className="iconbtn" data-testid={`grouping-row-${i}-down`} aria-label={t('report.grouping.moveDown')} title={t('report.grouping.moveDown')}
                disabled={readOnly || i === levels.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="ic ic-sm" aria-hidden /></button>
              <button type="button" className="iconbtn" data-testid={`grouping-row-${i}-delete`} aria-label={t('report.grouping.delete')} title={t('report.grouping.delete')}
                disabled={readOnly} onClick={() => remove(i)}><X className="ic ic-sm" aria-hidden /></button>
            </span>
          </div>
        ))}
      </div>
      <div className="rd-grouping-add">
        {(['group', 'sort'] as const).map((k) => (
          <button key={k} type="button" className="btn" data-testid={`grouping-add-${k}`} disabled={readOnly || !fields.length} title={fields.length ? undefined : t('report.grouping.noFields')}
            aria-haspopup="menu" aria-expanded={picker?.sort === (k === 'sort')} onClick={(e) => openPicker(k === 'sort', e.currentTarget)}>
            {t(k === 'group' ? 'report.grouping.addGroup' : 'report.grouping.addSort')}
          </button>
        ))}
      </div>
      {picker && (
        <PopupMenu x={picker.x} y={picker.y} testId="grouping-fields" labelKey="report.grouping.pickField" onClose={() => setPicker(null)}>
          {fields.map((f) => (
            <button key={f} type="button" role="menuitem" data-testid={`grouping-field-${f}`}
              onClick={() => { const sort = picker.sort; setPicker(null); edit((d) => (sort ? addSort(d, f) : addGroup(d, f))); }}>{f}</button>
          ))}
        </PopupMenu>
      )}
    </section>
  );
}

/** Le champ ou l'expression d'un niveau, comme une Source contrôle (nom de champ, ou « = » + expression affichée dans la langue
 *  de l'interface) ; validé à la sortie du champ, par Entrée, ou par un choix dans la liste ; un agrégat est refusé (pas de groupe
 *  sur un total) ; un texte vide est abandonné (un niveau a toujours une expression). */
function GroupExpression({ id, testId, value, fields, display, disabled, onCommit }: { id: string; testId: string; value: string; fields: string[];
  display: DisplayContext; disabled: boolean; onCommit(v: string): void }) {
  const { t } = useTranslation();
  const shown = controlSourceToDisplay(value, display);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const typing = useRef(false);
  const run = (s: string | null) => {
    if (s === null) return;
    const r = controlSourceToCanonical(s, display);
    if (!r.ok) { setDraft(s); setError(`expr.error.${r.code}`); return; }
    setDraft(null); setError(null);
    if (r.value !== undefined && r.value !== value) onCommit(r.value);
  };
  return (
    <div className="rd-gexpr" onInputCapture={() => { typing.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) run(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(draft); }
        else if (e.key === 'Escape' && draft !== null) { e.preventDefault(); e.stopPropagation(); setDraft(null); setError(null); }
      }}>
      <label className="sr-only" htmlFor={id}>{t('report.grouping.expression')}</label>
      <ComboBox id={id} testId={testId} label={t('report.grouping.expression')} value={draft ?? shown} disabled={disabled} describedBy={error ? `${id}-error` : undefined}
        options={fields.map((f, i) => ({ id: `o${i}`, label: f }))} onChange={(s) => { if (typing.current) setDraft(s); else run(s); typing.current = false; }} />
      {error && <div id={`${id}-error`} className="rd-gerror" role="alert" data-testid={`${testId}-error`}>{t(error)}</div>}
    </div>
  );
}
