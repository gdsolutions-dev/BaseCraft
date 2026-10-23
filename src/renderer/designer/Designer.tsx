// Concepteur générique (formulaires A4, états A5) : boîte à outils, surface de création, Feuille de propriétés (tâche 4), volet de l'hôte.
// Tout ce qui est propre au genre d'objet passe par l'hôte (DesignerHost) ; ce dossier n'importe jamais ../form.
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from '../../shared/design/colors';
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef } from '../../shared/design/model';
import { FORMATS_BY_TYPE } from '../../shared/expr/format';
import { EMBEDDED_FONTS } from '../../shared/fonts';
import { ComboBox } from '../shell/ComboBox';
import type { Rect } from './geometry';
import { DesignCanvas } from './DesignCanvas';
import { ARRANGE_MENUS, arrangeItemEnabled, selectedCount, type ArrangeMenu } from './designer-commands';
import type { DesignerAction, DesignerState, Selection } from './designer-model';
import { currentValue, fillAction, outlineAction, selectionSet, type FormatPopupId } from './format-commands';
import { fontWarning } from './property-sheet-model';
import { RibbonPopup } from './RibbonPopup';
import { ColorChoices, PropertySheet } from './PropertySheet';
import type { PropertySheetContext } from './sheet-types';
import { Toolbox } from './Toolbox';
import './designer.css';

export interface ToolDef { kind: ControlKind; icon: LucideIcon; labelKey: string }
export interface ToolState { kind: ControlKind | null; locked: boolean }   // null = Sélectionner
export interface DesignerHost {
  target: 'form' | 'report';
  tools: ToolDef[];
  sectionLabel(s: SectionDef, index: number): string;
  /** Aperçu en mode Création, sans les enfants. Doit être stable (useMemo de l'hôte) et ne lire que le genre et les propriétés du contrôle
   *  et de sa section : le canevas ne redessine un contrôle que si ceux-ci changent (CanvasControl est mémoïsé). */
  renderControl(c: ControlDef, s: SectionDef): ReactNode;
  newControls(kind: ControlKind, rect: Rect, section: number, doc: DesignDoc): ControlDef[];
  /** Menu contextuel de la barre de section. `confirmKey` : une question (Oui/Non, Non par défaut) posée avant l'action, par exemple
   *  quand elle supprime des contrôles (En-tête/pied de formulaire, d'état, de page). */
  sectionMenu?(index: number, doc: DesignDoc): { id: string; labelKey: string; action: DesignerAction; confirmKey?: string }[];
  sheet: PropertySheetContext;
}

export function Designer(p: { state: DesignerState; dispatch: (a: DesignerAction) => void; host: DesignerHost; readOnly: boolean;
  tool: ToolState; onTool(t: ToolState): void; sheetVisible: boolean; side?: ReactNode /* volet de l'hôte : liste des champs */;
  onSheetClose?(): void /* bouton Fermer de la feuille (l'hôte remet sheetVisible à faux) */ }) {
  return (
    <div className="dz" data-testid="designer">
      <Toolbox tools={p.host.tools} tool={p.tool} onTool={p.onTool} readOnly={p.readOnly} />
      <DesignCanvas state={p.state} dispatch={p.dispatch} host={p.host} readOnly={p.readOnly} tool={p.tool} onTool={p.onTool} />
      {p.sheetVisible && <PropertySheet state={p.state} dispatch={p.dispatch} docKind={p.host.target} ctx={p.host.sheet} readOnly={p.readOnly}
        onClose={p.onSheetClose} sectionLabel={p.host.sectionLabel} />}
      {p.side}
    </div>
  );
}

/** Le menu Taille/Espace ou Aligner, ouvert par `designerCommands` : la vue hôte l'affiche tant que `menu` est posé. */
export function ArrangePopup(p: { menu: ArrangeMenu; state: DesignerState; dispatch: (a: DesignerAction) => void; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { readOnly, onClose } = p;
  useEffect(() => { if (readOnly) onClose(); }, [readOnly, onClose]);   // la session passe en lecture seule : ses éléments changent le document
  const n = selectedCount(p.state);
  const run = (a: DesignerAction) => { p.onClose(); p.dispatch(a); };
  return (
    <RibbonPopup anchor={p.menu} testId="arrange-menu" labelKey={`designer.arrange.${p.menu}Menu`} onClose={p.onClose}>
      {ARRANGE_MENUS[p.menu].map((op) => [
        (op === 'spaceHorizontalEqual' || op === 'toggleSnap') && <div key={`sep-${op}`} className="ctxmenu-sep" role="separator" />,
        op === 'toggleSnap' ? (
          <button key={op} type="button" role="menuitemcheckbox" aria-checked={p.state.snap} data-testid={`arrange-menu-${op}`} onClick={() => run({ type: 'toggleSnap' })}>
            <Check size={14} aria-hidden style={{ visibility: p.state.snap ? 'visible' : 'hidden' }} />{t(`designer.arrange.${op}`)}
          </button>
        ) : (
          <button key={op} type="button" role="menuitem" data-testid={`arrange-menu-${op}`} disabled={!arrangeItemEnabled(op, n)} onClick={() => run({ type: 'arrange', op })}>
            {t(`designer.arrange.${op}`)}
          </button>
        ),
      ])}
    </RibbonPopup>
  );
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const NAMED_FORMATS = [...FORMATS_BY_TYPE.number, ...FORMATS_BY_TYPE.dateTime];
const COLOR_PROP: Partial<Record<FormatPopupId, string>> = { fontColor: 'ForeColor', backColor: 'BackColor', shapeFill: 'BackColor', shapeOutline: 'BorderColor' };

/** Un menu de l'onglet Format, ouvert par `formatCommands` (format-popup-<id>, éléments format-popup-<id>-<valeur>) : la vue hôte
 *  l'affiche tant que `id` est posé. Il écrit sur la sélection (selectionSet) ; Objet sélectionne, en lecture seule aussi. */
export function FormatPopup(p: { id: FormatPopupId; state: DesignerState; dispatch: (a: DesignerAction) => void; docKind: 'form' | 'report';
  sectionLabel(s: SectionDef, index: number): string; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { id, readOnly, onClose, docKind } = p;
  useEffect(() => { if (readOnly && id !== 'objectList') onClose(); }, [readOnly, id, onClose]);   // ses éléments changent le document
  const { doc, selection } = p.state;
  const testId = `format-popup-${id}`;
  const run = (a: DesignerAction | null) => { onClose(); if (a) p.dispatch(a); };
  const set = (values: Record<string, unknown>) => run(selectionSet(doc, docKind, selection, values));
  const item = (value: string, label: string, onClick: () => void, checked: boolean) => (
    <button key={value} type="button" role="menuitemradio" aria-checked={checked} data-testid={`${testId}-${value}`} onClick={onClick}>
      <Check size={14} aria-hidden style={{ visibility: checked ? 'visible' : 'hidden' }} />{label}
    </button>
  );
  let body: ReactNode;
  if (id === 'objectList') {   // comme la liste « Sélection » de la feuille (sheet-object)
    const sel = selection.kind === 'controls' && selection.names.length === 1 ? `c:${selection.names[0]}` : selection.kind === 'section' ? `s:${selection.index}` : selection.kind;
    const pick = (to: Selection) => run({ type: 'select', selection: to });
    body = [
      item('doc', t(`tabs.kind.${docKind}`), () => pick({ kind: 'doc' }), sel === 'doc'),
      ...doc.sections.map((s, i) => item(`s:${i}`, p.sectionLabel(s, i), () => pick({ kind: 'section', index: i }), sel === `s:${i}`)),
      ...doc.sections.flatMap((s) => flattenControls(s.controls)).map((c) => item(`c:${c.name}`, c.name, () => pick({ kind: 'controls', names: [c.name] }), sel === `c:${c.name}`)),
    ];
  } else if (id === 'font') {
    const v = currentValue(doc, docKind, selection, 'FontName');
    body = <FontPicker initial={typeof v === 'string' ? v : ''} testId={`${testId}-name`} label={t('designer.format.font')} onPick={(name) => set({ FontName: name })} />;
  } else if (id === 'fontSize') {
    const v = currentValue(doc, docKind, selection, 'FontSize');
    body = FONT_SIZES.map((n) => item(String(n), String(n), () => set({ FontSize: n }), v === n));
  } else if (id === 'format') {
    const v = currentValue(doc, docKind, selection, 'Format');
    body = NAMED_FORMATS.map((f) => item(f, t(`format.${f}`), () => set({ Format: f }), v === f));
  } else {
    const onPick = (c: ColorValue) => (id === 'shapeOutline' ? run(outlineAction(doc, docKind, selection, c))
      : id === 'shapeFill' ? set({ BackColor: c, BackStyle: 'normal' })   // une boîte transparente cacherait le remplissage
        : id === 'backColor' ? run(fillAction(doc, docKind, selection, c))   // de même, seulement là où le fond est transparent
          : set({ [COLOR_PROP[id]!]: c }));
    body = <ColorChoices value={currentValue(doc, docKind, selection, COLOR_PROP[id]!)} testId={`${testId}-colors`} onPick={onPick} />;
  }
  const labelKey = `designer.format.${COLOR_PROP[id] ? 'colors' : id}`;
  const dialog = id === 'font' || !!COLOR_PROP[id];   // a field, colour choices: no menu items
  return <RibbonPopup anchor={id} testId={testId} labelKey={labelKey} onClose={onClose} role={dialog ? 'dialog' : 'menu'}>{body}</RibbonPopup>;
}

/** Police : les polices embarquées, ou un nom libre (signalé non portable) validé par Entrée ; un choix dans la liste vaut aussitôt. */
function FontPicker(p: { initial: string; testId: string; label: string; onPick(name: string): void }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(p.initial);
  const typing = useRef(false);
  const note = fontWarning(draft);
  return (
    <div className="dz-pfield dz-format-font" onInputCapture={() => { typing.current = true; }}
      onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); p.onPick(draft.trim()); } }}>
      <ComboBox id={id} testId={p.testId} label={p.label} value={draft} options={EMBEDDED_FONTS.map((f, i) => ({ id: `o${i}`, label: f.family }))}
        onChange={(s) => { if (typing.current) setDraft(s); else p.onPick(s); typing.current = false; }} describedBy={note ? `${id}-msg` : undefined} />
      {note && <div id={`${id}-msg`} className="dz-pnote" data-testid={`${p.testId}-note`}>{t(note)}</div>}
    </div>
  );
}
