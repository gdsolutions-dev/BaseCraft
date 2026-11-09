// Feuille de propriétés générique (formulaires A4, états A5), ancrée à droite du concepteur : liste « Sélection », type de la sélection,
// onglets Format / Données / Événement / Autres / Toutes, un éditeur par propriété du catalogue (data-testid prop-<Nom>).
// Une valeur refusée reste dans l'éditeur avec son message (role="alert") et le document ne change pas. Un brouillon encore ouvert quand
// sa ligne disparaît (autre sélection, autre onglet) est validé ; refusé, il est signalé en tête de la feuille (sheet-lost).
// Onglet Événement (B2, R1, R16) : un nom de macro (liste des macros et sous-macros, texte libre) ou « [Macro incorporée] » ; « … » ouvre
// la macro incorporée (ou une nouvelle) dans son onglet du concepteur de macros, ou la macro nommée en mode Création.
import { toSourceRef } from '../../shared/record-source';
import { Ellipsis, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocTheme } from '../design/theme-context';
import { ColorEditor } from './ColorEditor';
export { ColorEditor };
import { readEvent } from '../../shared/design/events';
import { flattenControls, type ControlDef, type SectionDef } from '../../shared/design/model';
import type { CellRef } from '../../shared/design/layout';
import { PROPERTY_CATALOG, type PropertyDescriptor } from '../../shared/design/properties';
import { EMBEDDED_FONTS, isThemeFontRef } from '../../shared/fonts';
import { sameName } from '../../shared/field-types';
import { parseNumber } from '../../shared/locale-format';
import { emptyMacro } from '../../shared/macro/model';
import type { RecordSourceRef } from '../../shared/record-source';
import { listSeparator } from '../../shared/expr/localize';
import { ChooseBuilder } from './ChooseBuilder';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import { FunctionBuilder } from '../python/FunctionBuilder';
import { ExpressionField } from '../expr/ExpressionField';
import { eventSession, openEmbedded } from '../macro/embedded';
import { macroNamesWithSubs } from '../macro/macro-shell';
import { RowSourceBuilder } from '../query/QueryDesignView';
import { ComboBox } from '../shell/ComboBox';
import { useErrorDialog, useModal } from '../shell/Modal';
import { shellDispatch } from '../shell/modal-tab';
import type { DesignerAction, DesignerState } from './designer-model';
import { restrictedTabs, type DesignerRestrict } from './designer-restrict';
import { checkPropValue, columnWidthsToDisplay, columnWidthsToStored, controlSourceToCanonical, controlSourceToDisplay, eventToCanonical, eventToDisplay, fontFromLabel, fontLabel, fontWarning, fromSourceRef, themeFontChoices,
  MIXED, cellName, chartSummary, pictureLabel, setPictureType, readProp, sheetRows, targetExists, targetKind, targetsOf, type SheetRow } from './property-sheet-model';
import type { PropertySheetContext, SheetTab } from './sheet-types';
import { formatCm, parseCm } from './units';
import { PICTURE_ACCEPT } from '../../shared/pictures';
import { readPictureFile } from './image-gallery-model';
import { ImageGallery } from './ImageGallery';
import { api } from '../bridge';

const descOf = (name: string): PropertyDescriptor => PROPERTY_CATALOG.find((d) => d.name === name)!;
type Parsed = { value: unknown } | { error: string };
/** Une valeur refusée dont la ligne a disparu : le libellé de la propriété et la clé du message. */
interface Lost { label: string; msg: string }

export function PropertySheet(p: { state: DesignerState; dispatch(a: DesignerAction): void; docKind: 'form' | 'report'; ctx: PropertySheetContext; readOnly: boolean;
  onClose?(): void; sectionLabel?(s: SectionDef, index: number): string; restrict?: DesignerRestrict }) {
  const { state, dispatch, docKind, ctx, readOnly } = p;
  const { t } = useTranslation();
  const uid = useId();
  const shownTabs = restrictedTabs(p.restrict);
  const tabs: SheetTab[] = [...shownTabs, 'all'];
  const [picked, setTab] = useState<SheetTab>('all');
  // l'onglet choisi peut disparaître (Création -> Page garde la feuille, sans Événement) : Toutes à sa place
  const tab = tabs.includes(picked) ? picked : 'all';
  const [lost, setLost] = useState<Lost | null>(null);
  const { doc } = state;
  const targets = useMemo(() => targetsOf(state.selection), [state.selection]);
  const allRows = useMemo(() => sheetRows(doc, docKind, targets, tab, readOnly, t('designer.emptyCellPrefix')), [doc, docKind, targets, tab, readOnly, t]);
  const rows = p.restrict?.events ? allRows.filter((r) => shownTabs.includes(r.d.tab)) : allRows;   // Toutes aussi, sans les événements
  const selKey = JSON.stringify(targets);   // une autre sélection, un autre onglet : de nouveaux éditeurs (un brouillon en cours est validé)
  const [macros, setMacros] = useState<string[]>([]);   // la liste d'une propriété d'événement : les macros et leurs sous-macros
  useEffect(() => {
    let current = true;
    macroNamesWithSubs().then((m) => { if (current) setMacros(m); }, () => { /* une base fermée entre-temps : liste vide */ });
    return () => { current = false; };
  }, []);
  const cellLabel = (c: CellRef) => cellName(doc, c, t('designer.emptyCellPrefix'));
  const sectionText = (s: SectionDef, i: number) => (p.sectionLabel ? p.sectionLabel(s, i) : t(`designer.section.${s.kind}`));

  /** « … » d'un événement (R16) : la macro nommée en mode Création ; sinon sa macro incorporée, ou une nouvelle, dans son onglet. */
  const owner = ctx.owner;
  const buildEvent = owner && targets.length === 1 ? (d: PropertyDescriptor, value: unknown) => {
    const b = readEvent(value);
    if (b.kind === 'macro') { void shellDispatch({ type: 'open', kind: 'macro', name: b.name.split('.')[0]!, mode: 'design' }); return; }
    const target = targets[0]!;
    const where = target.kind === 'doc' ? t(`tabs.kind.${docKind}`) : target.kind === 'section' ? sectionText(doc.sections[target.index]!, target.index) : target.kind === 'cell' ? cellLabel(target) : target.name;
    openEmbedded(shellDispatch, eventSession({ owner: owner.tabId, title: t('macro.embedded.title', { object: owner.name, control: where, event: t(d.labelKey) }),
      def: b.kind === 'embedded' ? b.def : emptyMacro(), target, event: d.name, doc: owner.doc, dispatch }));
  } : undefined;

  const commit = (d: PropertyDescriptor, v: unknown): string | null => {
    for (const x of targets) { const e = checkPropValue(doc, x, d, v); if (e) return e; }
    if (d.name === 'PictureType') {
      // changer le type ne convertit jamais l'image : il change seulement la lecture de `Picture`. Vers Partagé, `Picture` est effacée
      // sauf si elle nomme déjà une image de la galerie ; vers Incorporé, un nom est effacé (une URL de données reste).
      const edit = (names: Set<string> | null) => dispatch({ type: 'edit', apply: (cur) => setPictureType(cur, docKind, targets, v === 'shared' ? 'shared' : 'embedded', names) });
      if (v !== 'shared') edit(null);
      else void api.resources.list().then((l) => edit(new Set(l.map((r) => r.name))), () => edit(new Set()));
      setLost(null);
      return null;
    }
    dispatch({ type: 'setProp', targets, name: d.name, value: v });
    setLost(null);
    return null;
  };

  const objValue = state.selection.kind === 'doc' ? 'doc' : state.selection.kind === 'section' ? `s:${state.selection.index}`
    : state.selection.names.length === 1 ? `c:${state.selection.names[0]}` : state.selection.names.length ? 'multi'
      : state.selection.cells?.length === 1 ? `cell:${state.selection.cells[0].layout}:${state.selection.cells[0].row}:${state.selection.cells[0].col}` : state.selection.cells?.length ? 'multi' : 'doc';
  const pickObject = (v: string) => {
    if (v === 'doc') dispatch({ type: 'select', selection: { kind: 'doc' } });
    else if (v.startsWith('s:')) dispatch({ type: 'select', selection: { kind: 'section', index: Number(v.slice(2)) } });
    else if (v.startsWith('cell:')) { const m = /^cell:(.+):(\d+):(\d+)$/.exec(v); if (m) dispatch({ type: 'selectCell', cell: { layout: m[1], row: Number(m[2]), col: Number(m[3]) }, add: false }); }
    else if (v.startsWith('c:')) dispatch({ type: 'select', selection: { kind: 'controls', names: [v.slice(2)] } });
  };
  const k = targets.length > 1 ? null : targetKind(doc, docKind, targets[0]);
  const typeLabel = targets.length > 1 ? t('sheet.multiple') : targets[0].kind === 'doc' ? t(`tabs.kind.${docKind}`)
    : targets[0].kind === 'section' ? t('sheet.section') : t(`sheet.kind.${k}`);
  // Origine source d'une liste : table/requête (liste déroulante) ou liste de valeurs (texte)
  const rowSourceTable = targets.every((x) => x.kind === 'control' && readProp(doc, docKind, x, descOf('RowSourceType')) === 'tableQuery');

  /** Onglets ARIA : un seul arrêt de tabulation, Gauche/Droite/Début/Fin passent d'un onglet à l'autre. */
  const tabKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length]
      : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  return (
    <aside className="dz-props" aria-label={t('sheet.title')} data-testid="property-sheet">
      <div className="dz-props-head">
        {t('sheet.title')}
        {p.onClose && (
          <button type="button" className="iconbtn" data-testid="sheet-close" aria-label={t('sheet.close')} title={t('sheet.close')} onClick={p.onClose}>
            <X className="ic ic-sm" aria-hidden />
          </button>
        )}
      </div>
      <div className="dz-props-type" data-testid="sheet-type">{t('sheet.selectionType', { type: typeLabel })}</div>
      <select className="dz-props-object" data-testid="sheet-object" aria-label={t('sheet.selection')} value={objValue} onChange={(e) => pickObject(e.target.value)}>
        {objValue === 'multi' && <option value="multi" disabled>{t('sheet.multiple')}</option>}
        <option value="doc">{t(`tabs.kind.${docKind}`)}</option>
        {doc.sections.map((s, i) => <option key={`s${i}`} value={`s:${i}`}>{sectionText(s, i)}</option>)}
        {doc.sections.flatMap((s) => flattenControls(s.controls)).map((c) => <option key={`c:${c.name}`} value={`c:${c.name}`}>{c.name}</option>)}
        {objValue.startsWith('cell:') && targetExists(doc, targets[0]) && <option value={objValue}>{cellLabel(targets[0] as CellRef)}</option>}
      </select>
      <div className="dz-props-tabs" role="tablist" aria-label={t('sheet.title')} onKeyDown={tabKey}>
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" id={`${uid}-tab-${x}`} aria-selected={tab === x} aria-controls={`${uid}-panel`} tabIndex={tab === x ? 0 : -1}
            data-testid={`sheet-tab-${x}`} className={`dz-props-tab${tab === x ? ' is-active' : ''}`} onClick={() => setTab(x)}>{t(`sheet.tab.${x}`)}</button>
        ))}
      </div>
      {lost && <div className="dz-props-lost" role="alert" data-testid="sheet-lost">{t('sheet.lost', { name: lost.label })} {t(lost.msg.split('|')[0]!, { name: lost.msg.split('|')[1] })}</div>}
      <div className="dz-props-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
        {rows.map((row) => (
          <PropRow key={`${selKey}:${tab}:${row.d.name}`} row={row} id={`${uid}-${row.d.name}`} ctx={ctx} docKind={docKind} rowSourceTable={rowSourceTable}
            commit={(v) => commit(row.d, v)} onLost={(msg) => setLost({ label: t(row.d.labelKey), msg })} macros={macros}
            buildEvent={buildEvent && ((v) => buildEvent(row.d, v))}
            shared={rows.find((r) => r.d.name === 'PictureType')?.value === 'shared'}
            transparent={row.d.name === 'BackColor' && targets.every((x) => x.kind === 'control') ? () => dispatch({ type: 'setProp', targets, name: 'BackStyle', value: 'transparent' }) : undefined} />
        ))}
      </div>
    </aside>
  );
}

interface RowProps { row: SheetRow; id: string; ctx: PropertySheetContext; docKind: 'form' | 'report'; rowSourceTable: boolean;
  commit(v: unknown): string | null; onLost(msg: string): void; macros: string[]; buildEvent?(value: unknown): void; transparent?(): void; shared?: boolean }

function PropRow({ row, id, ctx, docKind, rowSourceTable, commit, onLost, macros, buildEvent, transparent, shared }: RowProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const { d } = row;
  const { theme } = useDocTheme();
  const shownFont = typeof row.value === 'string' ? fontLabel(row.value, theme, t) : '';
  const themed = typeof row.value === 'string' && isThemeFontRef(row.value);   // « Inter (Détail) » n'est pas un nom de police à vérifier
  const mixed = row.value === MIXED;
  const v = mixed ? undefined : row.value;
  const testId = `prop-${d.name}`;
  const region = ctx.display.region;
  const aggregates = docKind === 'report';   // source contrôle seulement : un état a des groupes (A5) ; valeur par défaut et règle n'en ont jamais
  const text = (s: string): Parsed => ({ value: s.trim() === '' ? undefined : s.trim() });
  // « … » de Source et Contenu : le générateur de requête, un onglet modal qui rend son SQL (null = rien à changer)
  const [building, setBuilding] = useState<{ text: string; resolve(sql: string | null): void } | null>(null);
  const buildSql = (text: string) => new Promise<string | null>((resolve) => setBuilding({ text, resolve }));
  const field = (props: Omit<TextFieldProps, 'id' | 'testId' | 'label' | 'disabled' | 'mixed' | 'commit' | 'onLost'>) =>
    <TextField id={id} testId={testId} label={t(d.labelKey)} disabled={row.readOnly} mixed={mixed} commit={commit} onLost={onLost} {...props} />;

  let editor: ReactNode;
  if (d.editor === 'event') {
    const b = mixed ? null : readEvent(v);
    // « … » (R11): empty -> choose; a `=call` -> the function builder (its text read back like a typed one); anything else -> the macro builder
    const build = buildEvent && { buildTitle: t('sheet.eventBuild'), build: async (s: string) => {
      let kind: 'macro' | 'function' | null = s.trim() === '' ? null : s.trim().startsWith('=') ? 'function' : 'macro';
      if (kind === null && (kind = await modal.custom<'macro' | 'function'>((close) => <ChooseBuilder close={close} />, { titleKey: 'builder.choose.title' })) === null) return null;
      if (kind === 'macro') { buildEvent(s.trim()); return null; }
      const text = await modal.custom<string>((close) => <FunctionBuilder sep={listSeparator(region)} close={close} />, { titleKey: 'builder.function.title' });
      const r = text === null ? null : eventToCanonical(text, ctx.display);
      return r?.ok ? { value: r.value } : null;
    } };
    editor = b?.kind === 'embedded'
      ? <EmbeddedEditor id={id} testId={testId} disabled={row.readOnly} build={buildEvent && (() => buildEvent(v))} commit={commit} />
      // a name, or a text kept as imported (R1); typed or picked, it is checked by checkEventValue
      : field({ shown: b?.kind === 'macro' ? b.name : b?.kind === 'python' ? eventToDisplay(b.text, ctx.display) : b?.kind === 'other' ? b.text : '', options: macros,
        parse: (s) => { if (!s.trim().startsWith('=')) return text(s); const r = eventToCanonical(s, ctx.display); return r.ok ? { value: r.value } : { error: r.error }; }, ...build });
  } else if (d.name === 'ColumnWidths') {   // descripteur texte, montré en cm et stocké en twips (contrat 1.4)
    editor = field({ shown: columnWidthsToDisplay(typeof v === 'string' ? v : '', region), parse: (s) => {
      const w = columnWidthsToStored(s, region);
      return { value: w === '' ? undefined : w };   // null : illisible, refusé par checkPropValue
    } });
  } else {
    switch (d.editor) {
      case 'text': case 'fieldList':
        // Titre du graphique : le défaut est localisé, la feuille le montre tant que rien n'est saisi
        editor = field({ shown: v === undefined || v === null ? (d.name === 'ChartTitle' && !mixed ? t('chart.defaultTitle') : '') : String(v), parse: text });
        break;
      case 'chart':   // source, axe, valeurs : résumé en lecture seule, l'édition se fait dans les paramètres du graphique
        editor = <input id={id} data-testid={testId} readOnly value={mixed ? t('sheet.mixed') : chartSummary(d.name, v, (a) => t(`chart.settings.agg.${a}`))} />;
        break;
      case 'number':
        editor = field({ shown: typeof v === 'number' ? String(v).replace('.', region.decimalSep) : '',
          parse: (s) => ({ value: s.trim() === '' ? undefined : parseNumber(s, region) ?? Number.NaN }) });
        break;
      case 'twips':
        editor = field({ shown: typeof v === 'number' ? formatCm(v, region) : '', parse: (s) => ({ value: s.trim() === '' ? undefined : parseCm(s, region) ?? Number.NaN }) });
        break;
      case 'font':
        editor = field({ shown: typeof v === 'string' ? fontLabel(v, theme, t) : '', options: [...themeFontChoices(theme, t).map((c) => c.label), ...EMBEDDED_FONTS.map((f) => f.family)], parse: (s) => text(fontFromLabel(s, theme, t)), note: (s) => (themed && s === shownFont ? null : fontWarning(s)) });
        break;
      case 'controlSource':
        editor = field({ shown: controlSourceToDisplay(typeof v === 'string' ? v : undefined, ctx.display), options: ctx.fields,
          parse: (s) => { const r = controlSourceToCanonical(s, ctx.display, { aggregates }); return r.ok ? { value: r.value } : { error: `expr.error.${r.code}` }; },
          note: (s) => { const x = s.trim(); return x && !x.startsWith('=') && !ctx.fields.some((f) => sameName(f, x)) ? 'sheet.error.unknownField' : null; },
          // « … » : le générateur d'expressions, ouvert sur le brouillon (sans son « = ») ; vide -> la clé retirée
          build: async (s) => {
            const canonical = await modal.custom<string>((close) => (
              <ExpressionBuilder ctx={{ ...ctx.display, fields: ctx.fields, criteria: false, aggregates }} initial={s.trim().replace(/^=/, '')} close={close} />
            ), { titleKey: 'builder.title' });
            return canonical === null ? null : { value: canonical ? `=${canonical}` : undefined };
          } });
        break;
      case 'recordSource':
        editor = field({ shown: fromSourceRef((v ?? null) as RecordSourceRef | null), options: [...ctx.tables, ...ctx.queries],
          parse: (s) => { const ref = toSourceRef(s, ctx.tables, ctx.queries); return ref || !s.trim() ? { value: ref } : { error: 'sheet.error.unknownSource' }; },
          buildTitle: t('fieldProp.queryBuilder'),
          build: async (s) => { const sql = await buildSql(s); return sql === null ? null : { value: { kind: 'sql', sql } }; } });
        break;
      case 'objectName':
        editor = field({ shown: typeof v === 'string' ? v : '', options: ctx.objects(docKind), parse: text });
        break;
      case 'rowSource':   // stocké en texte (Access) ; liste de valeurs : a;b;c, jamais entre guillemets (splitValueList)
        editor = field({ shown: typeof v === 'string' ? v : '', options: rowSourceTable ? [...ctx.tables, ...ctx.queries] : undefined, parse: text,
          // une liste de valeurs n'a pas de générateur de requête
          ...(rowSourceTable ? { buildTitle: t('fieldProp.queryBuilder'), build: async (s: string) => {
            const sql = await buildSql(s);
            return sql === null ? null : { value: sql };
          } } : {}) });
        break;
      case 'bool':
        editor = (
          <select id={id} data-testid={testId} disabled={row.readOnly} value={mixed ? '' : String(v === true)} onChange={(e) => commit(e.target.value === 'true')}>
            {mixed && <option value="" disabled>{t('sheet.mixed')}</option>}
            <option value="true">{t('sheet.yes')}</option><option value="false">{t('sheet.no')}</option>
          </select>
        );
        break;
      case 'enum':
        editor = (
          <select id={id} data-testid={testId} disabled={row.readOnly} value={mixed ? '' : String(v ?? '')} onChange={(e) => commit(e.target.value)}>
            {(mixed || !d.options?.includes(String(v))) && <option value="" disabled>{mixed ? t('sheet.mixed') : ''}</option>}
            {d.options?.map((o) => {
              const key = `propValue.${d.name}.${o}`;
              return <option key={o} value={o}>{i18n.exists(key) ? t(key) : o}</option>;
            })}
          </select>
        );
        break;
      case 'color': editor = <ColorEditor id={id} testId={testId} value={v} mixed={mixed} disabled={row.readOnly} fill={!!transparent} commit={commit} transparent={transparent} />; break;
      case 'picture': editor = <PictureEditor id={id} testId={testId} value={v} mixed={mixed} disabled={row.readOnly} commit={commit} shared={!!shared} />; break;
      case 'textList': editor = <TextListEditor id={id} testId={testId} value={v} mixed={mixed} disabled={row.readOnly} commit={commit} />; break;
      case 'expression': case 'criteria':
        editor = <ExprEditor id={id} testId={testId} value={v} mixed={mixed} criteria={d.editor === 'criteria'} disabled={row.readOnly} ctx={ctx}
          commit={commit} onLost={onLost} />;
        break;
      default: editor = null;
    }
  }
  return (
    <div className="dz-prow" title={mixed ? t('sheet.mixed') : undefined}>
      <label htmlFor={id}>{t(d.labelKey)}</label>
      <div className="dz-pval">{editor}</div>
      {building && <RowSourceBuilder rowSource={building.text} onClose={(sql) => { setBuilding(null); building.resolve(sql); }} />}
    </div>
  );
}

/** Un brouillon validé à la sortie du champ, par Entrée, ou quand la ligne disparaît (une autre sélection) ; Échap l'abandonne.
 *  Un texte inchangé n'est jamais réécrit (l'affichage en cm perd de la précision). Un choix dans la liste est validé aussitôt.
 *  `build` : un bouton « … » (générateur d'expressions) dont le résultat est validé tel quel ; null = annulé. */
interface TextFieldProps { id: string; testId: string; label: string; disabled: boolean; mixed: boolean; shown: string; options?: string[];
  parse(text: string): Parsed; note?(text: string): string | null; build?(text: string): Promise<{ value: unknown } | null>; buildTitle?: string;
  commit(v: unknown): string | null; onLost(msg: string): void }
function TextField({ id, testId, label, disabled, mixed, shown, options, parse, note, build, buildTitle, commit, onLost }: TextFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const typing = useRef(false);
  const pending = useRef<() => void>(() => {});
  const run = (s: string | null): string | null => {
    if (s === null) return null;
    if (s === shown && !mixed) { setDraft(null); setError(null); return null; }
    const r = parse(s);
    const e = 'error' in r ? r.error : commit(r.value);
    setError(e);
    setDraft(e ? s : null);
    if (!e) pending.current = () => {};   // déjà validé : la ligne peut disparaître avant de se redessiner (nom changé)
    return e;
  };
  pending.current = () => { const e = run(draft); if (e) onLost(e); };   // refusé : signalé par la feuille, pas perdu en silence
  useEffect(() => () => pending.current(), []);
  const value = draft ?? shown;
  const msg = error ?? note?.(value) ?? null;
  const msgId = `${id}-msg`;
  const onChange = (s: string) => { if (options && !typing.current) run(s); else setDraft(s); typing.current = false; };
  const building = useRef(false);   // la boîte prend le focus : la sortie du champ ne valide pas le brouillon une seconde fois
  const openBuilder = async () => {
    building.current = true;
    const r = await build!(value).finally(() => { building.current = false; });
    if (!r) return;
    const e = commit(r.value);
    setError(e);
    if (!e) { setDraft(null); pending.current = () => {}; }
  };
  return (
    <div className="dz-pfield" onInputCapture={() => { typing.current = true; }}
      onBlur={(e) => { if (!building.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) run(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(draft); }
        else if (e.key === 'Escape' && draft !== null) { e.preventDefault(); e.stopPropagation(); setDraft(null); setError(null); }
      }}>
      {options?.length
        ? <ComboBox id={id} testId={testId} label={label} value={value} options={options.map((o, i) => ({ id: `o${i}`, label: o }))} disabled={disabled}
            onChange={onChange} describedBy={msg ? msgId : undefined} />
        : <input id={id} data-testid={testId} disabled={disabled} spellCheck={false} autoComplete="off" value={value} placeholder={mixed ? t('sheet.mixed') : undefined}
            aria-invalid={!!error} aria-describedby={msg ? msgId : undefined} onChange={(e) => onChange(e.target.value)} />}
      {build && (
        <button type="button" className="iconbtn" data-testid={`${testId}-build`} disabled={disabled} aria-label={buildTitle ?? t('builder.title')} title={buildTitle ?? t('builder.title')}
          onMouseDown={(e) => e.preventDefault()} onClick={() => void openBuilder()}><Ellipsis className="ic ic-sm" aria-hidden /></button>
      )}
      {msg && <div id={msgId} className={error ? 'dz-perror' : 'dz-pnote'} role={error ? 'alert' : undefined} data-testid={`${testId}-${error ? 'error' : 'note'}`}>{t(msg.split('|')[0]!, { name: msg.split('|')[1] })}</div>}
    </div>
  );
}

/** An embedded macro (R16): shown as « [Macro incorporée] », not typed over; Delete or Backspace clears it after a question. */
function EmbeddedEditor({ id, testId, disabled, build, commit }: { id: string; testId: string; disabled: boolean; build?(): void; commit(v: unknown): string | null }) {
  const { t } = useTranslation();
  const modal = useModal();
  const clear = async () => {
    const r = await modal.confirm({ titleKey: 'app.title', messageKey: 'macro.embedded.deleteAsk', buttons: ['yes', 'no'], defaultButton: 'no' });
    if (r === 'yes') commit(undefined);
  };
  return (
    <div className="dz-pfield">
      <input id={id} data-testid={testId} disabled={disabled} readOnly value={t('sheet.embeddedMacro')}
        onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void clear(); } }} />
      {build && (
        <button type="button" className="iconbtn" data-testid={`${testId}-build`} disabled={disabled} aria-label={t('sheet.eventBuild')} title={t('sheet.eventBuild')}
          onClick={build}><Ellipsis className="ic ic-sm" aria-hidden /></button>
      )}
    </div>
  );
}

function ExprEditor({ id, testId, value, mixed, criteria, disabled, ctx, commit, onLost }: { id: string; testId: string; value: unknown; mixed: boolean;
  criteria: boolean; disabled: boolean; ctx: PropertySheetContext; commit(v: unknown): string | null; onLost(msg: string): void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  return (
    <div className="dz-pfield">
      <ExpressionField id={id} testId={testId} value={typeof value === 'string' && value ? value : undefined} criteria={criteria} ctx={ctx.display}
        fields={ctx.fields} disabled={disabled} error={code ?? undefined} placeholder={mixed ? t('sheet.mixed') : undefined} onCommit={(c) => commit(c)} onInvalid={setCode} userFunctions
        onLostDraft={(c) => onLost(`expr.error.${c}`)} />
    </div>
  );
}

/** Une ligne par élément ; validé à la sortie du champ ou quand la ligne disparaît. */
function TextListEditor({ id, testId, value, mixed, disabled, commit }: { id: string; testId: string; value: unknown; mixed: boolean; disabled: boolean; commit(v: unknown): string | null }) {
  const { t } = useTranslation();
  const shown = Array.isArray(value) ? value.map(String).join('\n') : '';
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<() => void>(() => {});
  const run = () => {
    if (draft === null) return;
    setDraft(null);
    pending.current = () => {};
    if (draft === shown) return;
    const items = draft.split('\n').map((x) => x.trim()).filter(Boolean);
    commit(items.length ? items : undefined);
  };
  pending.current = run;
  useEffect(() => () => pending.current(), []);
  return <textarea id={id} data-testid={testId} disabled={disabled} rows={3} value={draft ?? shown} placeholder={mixed ? t('sheet.mixed') : undefined}
    onChange={(e) => setDraft(e.target.value)} onBlur={run} />;
}

function PictureEditor({ id, testId, value, mixed, disabled, commit, shared }: { id: string; testId: string; value: unknown; mixed: boolean; disabled: boolean;
  commit(v: unknown): string | null; shared: boolean }) {
  const { t } = useTranslation();
  const [gallery, setGallery] = useState<{ x: number; y: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const showError = useErrorDialog();
  const [error, setError] = useState<string | null>(null);
  const read = (f: File | undefined) => {
    if (!f) return;
    readPictureFile(f).then((url) => setError(commit(url)), (e: unknown) => {
      if (e instanceof Error && e.message === 'bc:pictureTooLarge') setError('sheet.error.pictureTooLarge'); else void showError(e);
    });
  };
  const set = typeof value === 'string' && value !== '';
  return (
    <div className="dz-pfield">
      {set && value.startsWith('data:image/') && <img className="dz-pthumb" src={value} alt="" />}
      {set && !shared && <span className="dz-pmixed">{pictureLabel({ Picture: value }, t('sheet.pictureType.embedded'))}</span>}
      {mixed && <span className="dz-pmixed">{t('sheet.mixed')}</span>}
      {shared ? (
        <button type="button" id={id} data-testid={`${testId}-shared`} className="dz-pbutton" disabled={disabled} aria-haspopup="dialog"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setGallery({ x: Math.max(0, r.left - 240), y: r.bottom }); }}>
          {set && !value.startsWith('data:') ? pictureLabel({ PictureType: 'shared', Picture: value }) : t('sheet.pickShared')}
        </button>
      ) : (
        <button type="button" id={id} data-testid={testId} className="dz-pbutton" disabled={disabled} aria-describedby={error ? `${id}-msg` : undefined}
          onClick={() => file.current?.click()}>{t('sheet.pickPicture')}</button>
      )}
      {gallery && <ImageGallery mode="insert" readOnly={disabled} at={gallery} onClose={() => setGallery(null)} onPick={(n) => { setGallery(null); setError(commit(n)); }} />}
      {(set || mixed) && (
        <button type="button" data-testid={`${testId}-clear`} className="dz-pbutton" disabled={disabled} onClick={() => { setError(null); commit(undefined); }}>
          {t('sheet.removePicture')}
        </button>
      )}
      <input ref={file} type="file" hidden accept={PICTURE_ACCEPT} data-testid={`${testId}-file`}
        onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <div id={`${id}-msg`} className="dz-perror" role="alert" data-testid={`${testId}-error`}>{t(error)}</div>}
    </div>
  );
}
