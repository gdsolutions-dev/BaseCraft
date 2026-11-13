// Format › Conditional Formatting: the rules of the one selected text box or combo box (Access's Rules Manager, kept small): each is
// "Field value is between / equal to / greater than…" or "Expression is…" with a format (bold, italic, underline, colours).
// The first rule that holds applies at run time (forms: calc.ts, reports: band.ts). Rules are stored as JSON in FormatConditions.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COND_OPS, readConditions, writeConditions, type CondOp, type FormatCondition } from '../../shared/design/format-conditions';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { withUserFunctions } from '../../shared/expr/user-functions';
import type { ModalApi } from '../shell/Modal';
import { findControl, type DesignerAction, type DesignerState } from './designer-model';

/** The name of the one selected text box or combo box (the controls that take rules), else null. */
export function conditionTarget(s: DesignerState): string | null {
  if (s.selection.kind !== 'controls' || s.selection.names.length !== 1) return null;
  const c = findControl(s.doc, s.selection.names[0]!)?.control;
  return c && (c.kind === 'textBox' || c.kind === 'comboBox') ? c.name : null;
}

const show = (canonical: string | undefined, ctx: DisplayContext): string => {
  if (canonical === undefined) return '';
  try { return toDisplay(canonical, ctx, { functions: withUserFunctions() }); } catch { return canonical; }
};
/** The typed operand in canonical form; a text that does not read throws. */
const store = (text: string, ctx: DisplayContext): string => toCanonical(text.trim(), ctx, { functions: withUserFunctions(), aggregates: false });

function ConditionsDialog(p: { rules: FormatCondition[]; display: DisplayContext; close(v: FormatCondition[] | null): void }) {
  const { t } = useTranslation();
  // the operands are edited in the interface language (display form) and stored canonical
  const [rows, setRows] = useState<FormatCondition[]>(() => p.rules.map((r) => ({ ...r, a: show(r.a, p.display), ...(r.b === undefined ? {} : { b: show(r.b, p.display) }) })));
  const [bad, setBad] = useState<number | null>(null);
  const set = (i: number, patch: Partial<FormatCondition>) => { setBad(null); setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const clear = (i: number, key: 'fore' | 'back') => setRows(rows.map((r, j) => { if (j !== i) return r; const { [key]: _gone, ...rest } = r; return rest; }));
  const ok = () => {
    const out: FormatCondition[] = [];
    for (const [i, r] of rows.entries()) {
      if (!r.a.trim() || (r.op === 'between' && !r.b?.trim())) continue;   // an empty rule is dropped
      const { b, ...rest } = r;
      try { out.push({ ...rest, a: store(r.a, p.display), ...(r.op === 'between' ? { b: store(b!, p.display) } : {}) }); } catch { setBad(i); return; }
    }
    p.close(out);
  };
  const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const };
  const colour = (i: number, key: 'fore' | 'back', label: string) => (
    <label style={row}>{label}
      <input type="color" data-testid={`cond-${key}-${i}`} value={rows[i]![key] ?? '#000000'} onChange={(e) => set(i, { [key]: e.target.value as FormatCondition['fore'] })} />
      {rows[i]![key] && <button type="button" className="btn" aria-label={t('designer.cond.noColor')} onClick={() => clear(i, key)}>×</button>}
    </label>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 460 }} data-testid="cond-dialog">
      {!rows.length && <p className="muted">{t('designer.cond.empty')}</p>}
      {rows.map((r, i) => (
        <fieldset key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid={`cond-rule-${i}`}>
          <div style={row}>
            <select aria-label={t('designer.cond.rule', { n: i + 1 })} data-testid={`cond-op-${i}`} value={r.op} onChange={(e) => set(i, { op: e.target.value as CondOp })}>
              {COND_OPS.map((o) => <option key={o} value={o}>{t(`designer.cond.op.${o}`)}</option>)}
            </select>
            <input type="text" data-testid={`cond-a-${i}`} aria-label={t('designer.cond.rule', { n: i + 1 })} value={r.a} onChange={(e) => set(i, { a: e.target.value })} />
            {r.op === 'between' && <>{t('designer.cond.and')}<input type="text" data-testid={`cond-b-${i}`} aria-label={t('designer.cond.and')} value={r.b ?? ''} onChange={(e) => set(i, { b: e.target.value })} /></>}
            <button type="button" className="btn" data-testid={`cond-remove-${i}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t('designer.cond.remove')}</button>
          </div>
          <div style={row}>
            {(['bold', 'italic', 'underline'] as const).map((k) => (
              <label key={k}><input type="checkbox" data-testid={`cond-${k}-${i}`} checked={r[k] === true} onChange={(e) => set(i, { [k]: e.target.checked })} /> {t(`ribbon.cmd.${k}`)}</label>
            ))}
            {colour(i, 'fore', t('prop.ForeColor'))}
            {colour(i, 'back', t('prop.BackColor'))}
          </div>
          {bad === i && <div role="alert" className="muted" data-testid="cond-error">{t('designer.cond.invalid', { n: i + 1 })}</div>}
        </fieldset>
      ))}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="cond-add" onClick={() => setRows([...rows, { op: 'between', a: '', b: '', bold: true }])}>{t('designer.cond.add')}</button>
        <button type="button" className="btn btn-primary" data-testid="cond-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="cond-cancel" onClick={() => p.close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

/** Opens the rules of the one selected text box or combo box; resolves the edit that stores them (null: cancelled, nothing to edit). */
export async function editConditions(modal: ModalApi, s: DesignerState, display: DisplayContext): Promise<DesignerAction | null> {
  const name = conditionTarget(s);
  const c = name === null ? undefined : findControl(s.doc, name)?.control;
  if (!name || !c) return null;
  const rules = await modal.custom<FormatCondition[]>((close) => <ConditionsDialog rules={readConditions(c.props.FormatConditions)} display={display} close={close} />,
    { titleKey: 'ribbon.cmd.conditionalFormatting' });
  return rules === null ? null : { type: 'setProp', targets: [{ kind: 'control', name }], name: 'FormatConditions', value: writeConditions(rules) };
}
