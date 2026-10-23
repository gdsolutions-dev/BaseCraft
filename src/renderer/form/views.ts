// Affichages d'un formulaire en mode Exécution (module pur) : affichage selon le mode de l'onglet (M10 : Formulaire = `run`,
// Feuille de données = `datasheet`), fenêtre visible du formulaire continu, colonnes de la feuille de données.
import type { ControlDef, DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import type { SourceInfo } from '../../shared/record-source';
import { twipsToPx } from '../designer/units';
import { boundField } from './control-values';

export type RunView = 'single' | 'continuous' | 'datasheet';

const holdsSubform = (cs: ControlDef[]): boolean => cs.some((c) => c.kind === 'subform' || holdsSubform(c.children ?? []));

/** Default View (props.DefaultView), Single Form otherwise; Single Form for Continuous Forms with a subform in the Detail (Access). */
export function initialView(doc: DesignDoc): RunView {
  const v = effectiveProp(doc.props, 'DefaultView', 'form');
  if (v === 'continuous') return holdsSubform(doc.sections.find((s) => s.kind === 'detail')?.controls ?? []) ? 'single' : v;
  return v === 'datasheet' ? v : 'single';
}

/** Datasheet view for the `datasheet` mode; Form view (`run`): the Default View, Single Form in place of Datasheet. */
export function runViewFor(mode: 'run' | 'datasheet', doc: DesignDoc): RunView {
  if (mode === 'datasheet') return 'datasheet';
  const v = initialView(doc);
  return v === 'datasheet' ? 'single' : v;
}

/** The mode a form opens in from the Navigation Pane. */
export function openingMode(doc: DesignDoc): 'run' | 'datasheet' {
  return initialView(doc) === 'datasheet' ? 'datasheet' : 'run';
}

const decided = new Set<string>();
/** True the first time a form view of this tab asks (tab ids are never reused): only then does the opening view apply. */
export function firstRun(tabId: string): boolean {
  if (decided.has(tabId)) return false;
  decided.add(tabId);
  return true;
}

/** Rows [start, end[ shown at scrollTop in a viewport, with `overscan` rows more on each side. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = 2): [number, number] {
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight) + overscan);
  return [Math.min(start, end), end];
}

export interface SheetColumn { control: string; field: string | null; title: string; width: number /* px */ }

const SHEET_KINDS: ControlDef['kind'][] = ['textBox', 'checkBox', 'optionGroup', 'comboBox', 'listBox'];

/** The Detail's input controls (an option group is one, not its options), in tab order (TabIndex, then document order; Tab
 *  Stop does not matter); title: the attached label's Caption without its trailing `:`, else the control's name. */
export function datasheetColumns(doc: DesignDoc, info: SourceInfo): SheetColumn[] {
  const detail = doc.sections.find((s) => s.kind === 'detail');
  const out: ControlDef[] = [];
  const walk = (cs: ControlDef[]) => cs.forEach((c) => {
    if (SHEET_KINDS.includes(c.kind)) out.push(c);
    if (c.kind !== 'optionGroup') walk(c.children ?? []);
  });
  walk(detail?.controls ?? []);
  const key = (c: ControlDef) => (typeof c.props.TabIndex === 'number' ? c.props.TabIndex : Number.MAX_SAFE_INTEGER);
  return out.map((c, i) => ({ c, i })).sort((a, b) => key(a.c) - key(b.c) || a.i - b.i).map(({ c }) => {
    const caption = (c.children ?? []).find((k) => k.kind === 'label')?.props.Caption;
    const title = typeof caption === 'string' && caption.trim() ? caption.replace(/\s*:\s*$/, '') : c.name;
    return { control: c.name, field: boundField(c, info)?.name ?? null, title, width: twipsToPx(c.width) };
  });
}
