// Un argument d'action dans le concepteur de macros, éditeur selon son type : liste des valeurs (enum), liste des objets
// (texte libre permis : un objet créé plus tard), ExpressionField (expression, condition WHERE), texte ou nombre dont la
// valeur commençant par « = » est une expression (forme affichée ↔ canonique), SQL multiligne gardé tel que tapé.
import { useEffect, useState, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExprErrorCode } from '../../shared/expr/ast';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { sameName } from '../../shared/field-types';
import type { ArgDef } from '../../shared/macro/catalog';
import type { RecordSourceRef } from '../../shared/record-source';
import { api } from '../bridge';
import { ExpressionField } from '../expr/ExpressionField';
import { ComboBox } from '../shell/ComboBox';
import type { ItemPath, MacroEditAction } from './macro-edit';
import { pathKey } from './macro-edit';

export type ObjectLists = Record<'table' | 'query' | 'form' | 'report' | 'macro', string[]>;   // macro: with its M.Sub names
export interface MacroViewCtx { display: DisplayContext; readOnly: boolean; send: Dispatch<MacroEditAction>; lists: ObjectLists }

/** An expression (canonical stored, display form shown), its error shown under it until a readable text is committed. */
export function ExprInput({ id, testId, value, fields = [], ctx, label, onCommit }: {
  id: string; testId: string; value: string | undefined; fields?: string[]; ctx: MacroViewCtx; label?: string; onCommit(canonical: string | undefined): void
}) {
  const [error, setError] = useState<ExprErrorCode | undefined>();
  return <ExpressionField id={id} testId={testId} value={value} ctx={ctx.display} fields={fields} disabled={ctx.readOnly} error={error} label={label}
    onCommit={onCommit} onInvalid={(c) => setError(c ?? undefined)} />;
}

/** The fields of a form's or report's record source, for the Where Condition's builder (none while the object does not exist). */
function useTargetFields(kind: 'form' | 'report', name: string, exists: boolean): string[] {
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    if (!exists) { setFields([]); return; }
    let current = true;
    api.objects.get(kind, name)
      .then((r) => { const src = (r.definition as { recordSource?: RecordSourceRef | null }).recordSource; return src ? api.sources.describe(src) : null; })
      .then((info) => { if (current) setFields(info ? info.fields.map((f) => f.name) : []); }, () => { if (current) setFields([]); });
    return () => { current = false; };
  }, [kind, name, exists]);
  return fields;
}

/** `=` + an expression shown in display form; any other text as stored. */
function shownText(v: string, ctx: DisplayContext): string {
  if (!v.startsWith('=')) return v;
  try { return `=${toDisplay(v.slice(1), ctx)}`; } catch { return v; }
}
/** The typed text as stored: `=` + the canonical expression when it reads (else as typed: Save reports it), any other text as is. */
function storedText(v: string, ctx: DisplayContext): string {
  if (!v.startsWith('=')) return v;
  try { return `=${toCanonical(v.slice(1), ctx)}`; } catch { return v; }
}

function WhereField({ id, testId, value, action, args, ctx, onCommit }: {
  id: string; testId: string; value: string | undefined; action: string; args: Record<string, string>; ctx: MacroViewCtx; onCommit(v: string | undefined): void
}) {
  const kind = action === 'OpenReport' ? 'report' : 'form';   // the actions that take a Where Condition
  const name = (kind === 'report' ? args.ReportName : args.FormName) ?? '';
  const fields = useTargetFields(kind, name, !!name && ctx.lists[kind].some((n) => sameName(n, name)));
  return <ExprInput id={id} testId={testId} value={value} fields={fields} ctx={ctx} onCommit={onCommit} />;
}

export function ArgEditor({ path, action, def, args, ctx }: { path: ItemPath; action: string; def: ArgDef; args: Record<string, string>; ctx: MacroViewCtx }) {
  const { t } = useTranslation();
  const id = `macro-arg-${pathKey(path)}-${def.name}-input`;
  const value = args[def.name];
  const set = (v: string | undefined) => { if (v !== value) ctx.send({ type: 'setArg', path, name: def.name, value: v === '' ? undefined : v }); };
  const [draft, setDraft] = useState<string | null>(null);   // a text / number argument being typed

  switch (def.type) {
    case 'enum': case 'objectType':
      return (
        <select id={id} data-testid={id} disabled={ctx.readOnly} value={value ?? def.default ?? ''} onChange={(e) => set(e.target.value)}>
          {def.options!.map((o) => <option key={o} value={o}>{t(`macro.argValue.${def.name}.${o || 'empty'}`)}</option>)}
        </select>
      );
    case 'formName': case 'reportName': case 'queryName': case 'tableName': case 'macroName': case 'objectName': {
      const kind = def.type === 'objectName' ? args.ObjectType as keyof ObjectLists | undefined : def.type.replace('Name', '') as keyof ObjectLists;
      const names = (kind && ctx.lists[kind]) || [];
      return <ComboBox id={id} testId={id} label={t(`macro.arg.${def.name}`)} value={value ?? ''} disabled={ctx.readOnly}
        options={names.map((n) => ({ id: n, label: n }))} onChange={set} />;
    }
    case 'expression':
      return <ExprInput id={id} testId={id} value={value} ctx={ctx} onCommit={set} />;
    case 'where':
      return <WhereField id={id} testId={id} value={value} action={action} args={args} ctx={ctx} onCommit={set} />;
    case 'sql':
      return <textarea id={id} data-testid={id} disabled={ctx.readOnly} spellCheck={false} rows={3} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'text': case 'number': {
      const commit = () => { if (draft !== null) { set(storedText(draft, ctx.display)); setDraft(null); } };
      return <input id={id} data-testid={id} disabled={ctx.readOnly} spellCheck={false} value={draft ?? shownText(value ?? '', ctx.display)}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
    }
  }
}
