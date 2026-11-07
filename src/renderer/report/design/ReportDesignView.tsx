// État en mode Création : le concepteur générique (A4) avec l'hôte des états, la Feuille de propriétés, la Liste des champs,
// la mise en page du ruban ; chargement par loadReportDoc, enregistrement par api.objects (genre 'report').
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlKind, DesignDoc } from '../../../shared/design/model';
import type { DisplayContext } from '../../../shared/expr/localize';
import { sameName } from '../../../shared/field-types';
import { localeInfo } from '../../../shared/locale-format';
import type { SourceField } from '../../../shared/record-source';
import { uniqueReportName } from '../../../shared/report/instant';
import { effectiveTheme } from '../../../shared/design/theme';
import { DocThemeProvider, useBaseTheme } from '../../design/theme-context';
import { readReport, type PageSetup } from '../../../shared/report/model';
import { api } from '../../bridge';
import { ArrangePopup, Designer, FormatPopup, LayoutPopupMenu, type CanvasProps, type ToolState } from '../../designer/Designer';
import { clipboardCommands, clipContext, pasteEnabled, subscribeClip } from '../../designer/designer-clipboard';
import { designerCommands, selectedCount, type ArrangeMenu } from '../../designer/designer-commands';
import { formatCommands, type FormatPopupId } from '../../designer/format-commands';
import { layoutCommands, layoutKey, type LayoutPopup } from '../../designer/layout-commands';
import { deleteKeyAllowed } from '../../designer/delete-guard';
import { designerReducer, findControl, initDesigner, sectionBottomLimit, setDocProp, type DesignerAction } from '../../designer/designer-model';
import { registerOpenDesign } from '../../designer/open-designs';
import { ColorsGallery } from '../../designer/ColorsGallery';
import { FontsGallery } from '../../designer/FontsGallery';
import { ThemeGallery } from '../../designer/ThemeGallery';
import { boundControlWithLabel } from '../../designer/field-controls';
import { FieldList } from '../../designer/FieldList';
import { fromSourceRef } from '../../designer/property-sheet-model';
import { RibbonPopup } from '../../designer/RibbonPopup';
import type { PropertySheetContext } from '../../designer/sheet-types';
import type { DocViewProps } from '../../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal, type ModalApi } from '../../shell/Modal';
import { nameErrorKey } from '../../shell/nav-menu-items';
import { firstPythonCall, viewCode } from '../../designer/view-code';
import { registerCommandStates, registerCommands, registerModeGuard, runCommand, type CommandHandlers, type CommandId } from '../../shell/ribbon-model';
import { editsDesign, sameView, type DocMode } from '../../state/app-state';
import { allowsLayout } from '../../form/views';
import { unsavedRunDoc } from '../../query/unsaved-run';
import { loadReportDoc, ReportLoadError } from '../load';
import { withPageSetup } from '../page-setup';
import { PageSetupDialog, PageSetupMenu } from '../PageSetupDialog';
import { ReportLayoutCanvas } from '../ReportLayoutCanvas';
import { previewFromDesign, ReportIssues } from '../ReportPreviewView';
import { useReportFlow } from '../useReportFlow';
import { addTotal, TOTAL_FNS, type TotalFn } from './grouping-model';
import { GroupingPane } from './GroupingPane';
import { headerItemControls, insertPageNumbers, reportHeaderItem } from './header-items';
import { PageNumbersDialog, type PageNumberChoice } from './PageNumbersDialog';
import { reportHost, reportRenderControl } from './report-host';
import { printMargins } from '../../settings-store';
import { blankReport, detailHidden, removesControls, reportDesignStates } from './report-sections';
import { layoutNoticeKey, reportView } from './report-view';

const FIELD_LEFT = 1418;   // 2,5 cm : un champ ajouté sans point de dépôt, son étiquette à gauche
const FIELD_GAP = 113;     // 0,2 cm sous le contrôle le plus bas
const PICTURE_MAX = 1024 * 1024;   // un logo de 1 Mo au plus, comme la propriété Image (feuille de propriétés)
interface Lists { tables: string[]; queries: string[]; forms: string[]; reports: string[] }
const NO_LISTS: Lists = { tables: [], queries: [], forms: [], reports: [] };
/** La galerie Contrôles du ruban choisit l'outil de la boîte à outils. */
const TOOL_COMMANDS: Partial<Record<CommandId, ControlKind | null>> = {
  select: null, textBox: 'textBox', label: 'label', insertPageBreak: 'pageBreak', comboBox: 'comboBox', line: 'line', rectangle: 'rectangle',
  checkBox: 'checkBox', optionButton: 'optionButton', image: 'image',
};

// État vierge (Créer › État vide) : la Liste des champs s'ouvre avec l'onglet de ce nom, une seule fois.
const fieldListRequests = new Set<string>();
export function requestFieldList(name: string): void { fieldListRequests.add(name); }
const takeFieldListRequest = (name: string): boolean => fieldListRequests.delete(name);

interface Leaving { mode: DocMode; name: string; isNew: boolean; busy: boolean; flush(): Promise<void>; dirty(): boolean; confirm: ModalApi['confirm']; save(): Promise<boolean>; unsaved(keep: boolean): void }
/** Avant que la vue parte : l'Aperçu avant impression et l'état (Mode État) montrent l'état tel qu'il est, enregistré ou non (Access,
 *  comme une requête). Fermer : des modifications -> Oui (enregistrer), Non (abandonnées), Annuler. Création ↔ Page (L3) : le même
 *  concepteur reste, rien n'est demandé (modifications et annulations gardées), pas même pendant un enregistrement. */
export async function leaveReportDesign(reason: 'mode' | 'close', target: DocMode | undefined, d: Leaving): Promise<boolean> {
  if (reason === 'mode' && sameView(d.mode, target)) return true;
  if (d.busy) return false;
  await d.flush();
  if (reason === 'mode' && (target === 'run' || target === 'state')) { d.unsaved(d.isNew || d.dirty()); return true; }
  if (reason === 'mode' && d.isNew) {
    // garde-fou : seul l'aperçu ou l'état (ci-dessus) peut quitter un état jamais enregistré ; une autre voie le lirait absent de la base
    return d.save();
  }
  if (d.dirty() || d.isNew) {
    const r = await d.confirm({ titleKey: 'report.saveFirstTitle', messageKey: 'report.saveFirst', params: { name: d.name }, buttons: ['yes', 'no', 'cancel'] });
    if (r === 'cancel' || (r === 'yes' && !(await d.save()))) return false;
  }
  return true;
}

export function ReportDesignView({ tab, active, readOnly, dispatch }: DocViewProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [state, send] = useReducer(designerReducer, undefined, () => initDesigner(blankReport(printMargins()), 'report'));
  const [phase, setPhase] = useState<'loading' | 'ready' | { error: string; list?: string[] }>(tab.isNew ? 'ready' : 'loading');
  const [described, setDescribed] = useState<{ key: string; fields: SourceField[] }>({ key: 'null', fields: [] });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [lists, setLists] = useState<Lists>(NO_LISTS);
  const [region, setRegion] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolState>({ kind: null, locked: false });
  const [sheetVisible, setSheetVisible] = useState(true);
  const [fieldList, setFieldList] = useState(() => takeFieldListRequest(tab.name));
  const [menu, setMenu] = useState<ArrangeMenu | null>(null);
  const [formatMenu, setFormatMenu] = useState<FormatPopupId | null>(null);
  const [themesOpen, setThemesOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState<LayoutPopup | null>(null);
  const [pageMenu, setPageMenu] = useState<'margins' | 'pageSize' | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [totalsMenu, setTotalsMenu] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const loaded = useRef<{ name: string; token: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const display = useMemo<DisplayContext>(() => ({ lang, region: localeInfo(region ?? 'en-US') }), [lang, region]);
  const source = state.doc.recordSource;
  const sourceKey = JSON.stringify(source);
  const fields = described.key === sourceKey ? described.fields : [];
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const sheet = useMemo<PropertySheetContext>(() => ({ display, fields: fieldNames, tables: lists.tables, queries: lists.queries,
    objects: (k) => (k === 'form' ? lists.forms : lists.reports), owner: { tabId: tab.id, name: tab.name, doc: () => live.current.state.doc } }),
    [display, fieldNames, lists, tab.id, tab.name]);
  const theme = effectiveTheme(state.doc.props, useBaseTheme());   // les états se dessinent toujours en mode clair
  const renderControl = useMemo(() => reportRenderControl(display), [display]);
  const host = useMemo(() => reportHost({ doc: state.doc, sheet, t, renderControl }), [state.doc, sheet, t, renderControl]);
  // les avertissements du moteur, une fois les champs de la source connus
  // (une source illisible : ses champs inconnus ne sont pas répétés champ par champ, le bandeau le dit)
  const issues = useMemo(() => (described.key === sourceKey ? readReport(state.doc, described.fields, { theme }).issues : [])
    .filter((i) => !sourceError || i.code !== 'unknownField'), [state.doc, described, sourceKey, sourceError, theme]);
  // Totaux : une seule zone de texte du Détail liée à un champ de la source est sélectionnée
  const totalTarget = useMemo(() => {
    const sel = state.selection;
    if (sel.kind !== 'controls' || sel.names.length !== 1) return null;
    const e = findControl(state.doc, sel.names[0]!);
    const src = e?.control.props.ControlSource;
    if (!e || e.control.kind !== 'textBox' || state.doc.sections[e.section]?.kind !== 'detail' || typeof src !== 'string' || src.startsWith('=')) return null;
    const field = fields.find((f) => sameName(f.name, src));
    return field ? { name: e.control.name, field } : null;
  }, [state.selection, state.doc, fields]);
  const totalKey = totalTarget?.name ?? null;

  const live = useRef({ state, readOnly, tab, phase, totalTarget });
  live.current = { state, readOnly, tab, phase, totalTarget };
  const liveHost = useRef(host);   // à part : `host` lit `live` (la feuille)
  liveHost.current = host;

  // la définition : à l'ouverture, puis à chaque enregistrement venu d'ailleurs tant que rien n'est modifié ici
  useEffect(() => {
    if (tab.isNew) return;
    const prev = loaded.current;
    loaded.current = { name: tab.name, token: tab.reloadToken };
    if (prev && (prev.token === tab.reloadToken || live.current.state.dirty)) return;   // renommé, notre propre enregistrement, ou des modifications à garder
    let current = true;
    loadReportDoc(api, tab.name).then((doc) => {
      if (!current) return;
      send({ type: 'load', doc, objectKind: 'report' });
      setPhase('ready');
      // L3 : un état dont la définition interdit le mode Page s'ouvre en mode Création (quelle que soit la voie qui l'a demandé)
      if (live.current.tab.mode === 'layout' && !allowsLayout(doc, 'report')) dispatch({ type: 'setMode', id: tab.id, mode: 'design' });
    }, (e) => {
      if (!current) return;
      if (e instanceof ReportLoadError) { setPhase({ error: t(`report.${e.code}`), list: e.list }); return; }
      const m = errorMessage(e);
      setPhase({ error: t(m.key, m.params) });
    });
    return () => { current = false; };
  }, [tab.name, tab.isNew, tab.reloadToken, t]);

  // les tables et objets proposés par la feuille (source, sous-état, contenu des listes)
  useEffect(() => {
    let current = true;
    Promise.all([api.tables.list(), api.objects.list()]).then(([ts, os]) => {
      if (!current) return;
      const of = (k: string) => os.filter((o) => o.kind === k).map((o) => o.name);
      setLists({ tables: ts.map((x) => x.name), queries: of('query'), forms: of('form'), reports: of('report') });
    }, () => { /* une base fermée entre-temps : la feuille propose des listes vides */ });
    return () => { current = false; };
  }, [tab.reloadToken]);

  // les champs de la source (feuille, Liste des champs, avertissements) ; une erreur s'affiche, le concepteur reste utilisable
  useEffect(() => {
    setSourceError(null);
    if (!source) { setDescribed({ key: sourceKey, fields: [] }); return; }
    let current = true;
    api.sources.describe(source).then((info) => { if (current) setDescribed({ key: sourceKey, fields: info.fields }); }, (e) => {
      if (!current) return;
      const m = errorMessage(e);
      setDescribed({ key: sourceKey, fields: [] });
      setSourceError(t('report.sourceError', { name: fromSourceRef(source), message: t(m.key, m.params) }));
    });
    return () => { current = false; };
  }, [sourceKey, tab.reloadToken, t]);   // `source` suit sourceKey

  // `tab.mode`: back from the preview (this design stays mounted behind it), whose unmount cleared the tab's flag (as a query)
  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: state.dirty }); }, [state.dirty, tab.id, tab.mode, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]);   // les modifications partent avec la vue

  // Suppr, Ctrl+Z / Ctrl+Y (Access), comme FormDesignView : annuler, rétablir où que soit le focus dans la vue ou sur le ruban (la surface
  // les traite elle-même) ; jamais dans une zone de saisie, qui garde sa propre annulation
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const del = e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;   // Suppr après un bouton du ruban (Sélectionner la ligne…) : le focus n'est pas sur la surface
      if (e.defaultPrevented || (!del && (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (k !== 'z' && k !== 'y')))) return;
      const el = e.target as HTMLElement;
      if (live.current.readOnly || document.querySelector('[aria-modal="true"]') || el.isContentEditable || el instanceof HTMLTextAreaElement
        || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'color', 'file', 'range'].includes(el.type))) return;
      if (el !== document.body && !root.current?.contains(el) && !el.closest('.ribbon')) return;
      if (del && !deleteKeyAllowed(el)) return;   // Suppr depuis un select, une case, un onglet… : pas de suppression de la sélection
      e.preventDefault();
      send({ type: del ? 'deleteSelection' : k === 'z' ? 'undo' : 'redo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  /** Toute action passe par ici : une modification qui fait disparaître des contrôles (paire de sections, regroupement) demande d'abord. */
  const guarded = useCallback((a: DesignerAction) => {
    if (a.type === 'edit') {
      const doc = live.current.state.doc;
      if (removesControls(doc, a.apply(doc))) {
        void modal.confirm({ titleKey: 'app.title', messageKey: 'report.confirmRemoveSections', buttons: ['yes', 'no'], defaultButton: 'no' })
          .then((r) => { if (r === 'yes') send(a); });
        return;
      }
    }
    send(a);
  }, [modal]);

  /** Un brouillon de la feuille se valide à la sortie du champ : il atteint le document avant l'enregistrement. */
  const flush = async () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !root.current?.contains(el)) return;
    el.blur();
    await new Promise((r) => setTimeout(r));
  };
  const askName = (initial: string) => modal.prompt({ titleKey: 'report.saveAsTitle', labelKey: 'report.nameLabel', initial,
    validate: (v) => { const k = nameErrorKey(v); return k && t(k); } });

  const save = async (): Promise<boolean> => {
    const { readOnly: ro, tab: doc, phase: ph } = live.current;
    if (ro || ph !== 'ready' || busy.current) return false;
    busy.current = true;
    try {
      await flush();
      let name = doc.isNew ? await askName(uniqueReportName((await api.objects.list('report')).map((o) => o.name), doc.name)) : doc.name;
      for (;;) {
        if (name === null) return false;
        const r = await api.objects.save('report', name, live.current.state.doc, doc.isNew ? null : doc.name);
        if (r.ok) {
          send({ type: 'saved' });
          loaded.current = { name, token: doc.reloadToken + 1 };   // objectSaved l'augmente : ce n'est pas une modification venue d'ailleurs
          dispatch(doc.isNew ? { type: 'objectSaved', kind: 'report', name, tabId: doc.id } : { type: 'objectSaved', kind: 'report', name });
          return true;
        }
        await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] });
        if (!doc.isNew || (r.reason !== 'nameExists' && r.reason !== 'nameInvalid')) return false;
        name = await askName(name);
      }
    } catch (e) {
      await showError(e);   // bc:invalidArgument au-delà de la taille permise : le concepteur reste modifié
      return false;
    } finally {
      busy.current = false;
    }
  };

  /** Vers l'aperçu, son « Fermer » ramènera ici. */
  const leave = async (reason: 'mode' | 'close', target?: DocMode): Promise<boolean> => {
    const doc = live.current.tab;
    const ok = await leaveReportDesign(reason, target, {
      mode: doc.mode, name: doc.name, isNew: !!doc.isNew, busy: busy.current, flush, dirty: () => live.current.state.dirty, confirm: modal.confirm, save,
      unsaved: (keep) => { // what the preview shows: the design as it stands, unsaved
        if (keep) unsavedRunDoc.set(doc.id, live.current.state.doc); else unsavedRunDoc.delete(doc.id);
      },
    });
    if (ok && reason === 'mode' && !sameView(doc.mode, target)) previewFromDesign.set(doc.id, doc.mode);   // « Fermer » y ramène
    return ok;
  };

  const setup = (patch: Partial<PageSetup>) => guarded({ type: 'edit', apply: (d) => withPageSetup(d, patch) });
  const pageSetupDialog = async () => {
    const next = await modal.custom<PageSetup>((close) => <PageSetupDialog initial={readReport(live.current.state.doc, []).page} onClose={close} />,
      { titleKey: 'report.pageSetup.title' });
    if (next && !live.current.readOnly) setup(next);
  };

  /** Masquer les détails : la propriété Visible du Détail (faux, ou retirée pour revenir au défaut), annulable. */
  const hideDetails = () => {
    const doc = live.current.state.doc;
    const i = doc.sections.findIndex((x) => x.kind === 'detail');
    if (i < 0 || live.current.readOnly) return;
    guarded({ type: 'setProp', targets: [{ kind: 'section', index: i }], name: 'Visible', value: detailHidden(doc) ? undefined : false });
  };
  const pageNumbers = async () => {
    const o = await modal.custom<PageNumberChoice>((close) => <PageNumbersDialog onClose={close} />, { titleKey: 'report.pageNumbers.title' });
    if (o && !live.current.readOnly) guarded({ type: 'edit', apply: (d) => insertPageNumbers(d, { ...o, lang }) });
  };
  /** Logo, Titre (le nom de l'onglet), Date et heure : dans l'en-tête d'état, puis sélectionnés ; un titre, une date et une heure
   *  déjà là sont repris (sélectionnés), pas copiés. */
  const headerItem = (item: 'logo' | 'title' | 'dateTime', picture?: string) => {
    const { state: s, readOnly: ro } = live.current;
    if (ro) return;
    const apply = (d: DesignDoc) => reportHeaderItem(d, item, { title: live.current.tab.name, ...(picture ? { picture } : {}) });
    const next = apply(s.doc);
    const names = item === 'logo' ? next.sections.flatMap((x) => x.controls).filter((c) => !findControl(s.doc, c.name)).map((c) => c.name)
      : headerItemControls(next, item);
    guarded({ type: 'edit', apply });
    if (names.length) send({ type: 'select', selection: { kind: 'controls', names } });
  };
  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > PICTURE_MAX) { void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'sheet.error.pictureTooLarge', buttons: ['ok'] }); return; }
    const r = new FileReader();
    r.onload = () => headerItem('logo', String(r.result));
    r.readAsDataURL(f);
  };
  /** Le total choisi, sous la zone de texte sélectionnée ; le premier contrôle ajouté est sélectionné (la feuille le montre). */
  const total = (fn: TotalFn) => {
    const { state: s, readOnly: ro, totalTarget: target } = live.current;
    const e = target && findControl(s.doc, target.name);
    if (ro || !target || !e) return;
    const apply = (d: DesignDoc) => addTotal(d, target.field, fn, e.control.left, e.control.width, target.name);
    const added = apply(s.doc).sections.flatMap((x) => x.controls).find((c) => !findControl(s.doc, c.name));
    guarded({ type: 'edit', apply });
    if (added) send({ type: 'select', selection: { kind: 'controls', names: [added.name] } });
  };

  const cmds = useRef({ save, leave, pageSetupDialog, hideDetails, pageNumbers, headerItem });
  cmds.current = { save, leave, pageSetupDialog, hideDetails, pageNumbers, headerItem };
  const selected = selectedCount(state);
  const layoutKind = layoutKey(state);
  // the preview runs in front (DocumentView keeps this design behind it): this design registers no command, only its close guard
  // (closing the tab there asks to save the design, as a query does). A tab merely in the
  // background still registers, its close guard above all (else a modified report closed from another tab is lost unasked)
  const behind = !editsDesign(tab.mode);
  // la galerie des thèmes retrouve ce concepteur pour lui retirer son thème propre
  useEffect(() => registerOpenDesign({ kind: 'report', name: tab.name, clearTheme: () => {
    if (live.current.state.doc.props.Theme !== undefined) send({ type: 'edit', apply: (d) => setDocProp(d, 'Theme', undefined) });
  } }), [tab.name]);
  useEffect(() => {
    if (behind) return registerModeGuard(tab.id, (reason, target) => (reason === 'close' ? cmds.current.leave(reason, target) : true));
    const tools: CommandHandlers = Object.fromEntries(Object.entries(TOOL_COMMANDS).map(([id, kind]) => [id, () => setTool({ kind: kind ?? null, locked: false })]));
    const off = registerCommands(tab.id, {
      ...designerCommands(guarded, setMenu, selected),
      themes: () => setThemesOpen(true),
      themeColors: () => setColorsOpen(true),
      themeFonts: () => setFontsOpen(true),
      ...formatCommands(() => live.current.state, guarded, setFormatMenu, selected),   // the report's own defaults (documentKind)
      ...layoutCommands(() => live.current.state, guarded, undefined, setLayoutMenu),
      ...clipboardCommands(() => live.current.state, guarded, () => clipContext(liveHost.current, t)),
      ...tools,
      save: async () => { await cmds.current.save(); },
      addExistingFields: () => setFieldList((v) => !v),
      propertySheet: () => setSheetVisible((v) => !v),
      viewCode: () => { const { state: s } = live.current; viewCode(firstPythonCall(s.doc, s.selection), (name, line) => { void dispatch({ type: 'open', kind: 'module', name, mode: 'design', args: { line } }); }, () => { runCommand('createModule'); }).catch(showError); },
      pageSetupDialog: () => cmds.current.pageSetupDialog(),
      portrait: () => setup({ orientation: 'portrait' }),
      landscape: () => setup({ orientation: 'landscape' }),
      margins: () => setPageMenu((m) => (m === 'margins' ? null : 'margins')),
      pageSize: () => setPageMenu((m) => (m === 'pageSize' ? null : 'pageSize')),
      groupSort: () => setGrouping((v) => !v),
      ...(totalKey ? { reportTotals: () => setTotalsMenu((v) => !v) } : {}),   // sinon le ruban le montre désactivé
      hideDetails: () => cmds.current.hideDetails(),
      pageNumbers: () => cmds.current.pageNumbers(),
      logo: () => logoInput.current?.click(),
      title: () => cmds.current.headerItem('title'),
      dateTime: () => cmds.current.headerItem('dateTime'),
    });
    const offGuard = registerModeGuard(tab.id, (reason, target) => cmds.current.leave(reason, target));
    return () => { off(); offGuard(); };
  }, [tab.id, behind, selected, layoutKind, guarded, totalKey]);   // setup ne lit que guarded

  // boutons enfoncés : orientation, volet Regrouper, trier et total affiché, Détail masqué
  const pasteable = useSyncExternalStore(subscribeClip, () => pasteEnabled(host.tools.map((x) => x.kind)));   // Coller grisé sinon
  // L3 : mode Page éteint quand AllowLayoutView vaut false (la valeur en cours de modification compte) ; le volet Regrouper est
  // masqué en mode Page, son bouton n'y est donc pas enfoncé
  const states = JSON.stringify({ ...reportDesignStates(state.doc, grouping && tab.mode !== 'layout'), paste: { enabled: pasteable }, viewLayout: { enabled: allowsLayout(state.doc, 'report') } });
  useEffect(() => (behind ? undefined : registerCommandStates(tab.id, JSON.parse(states))), [tab.id, behind, states]);

  // un champ de la Liste des champs : au point de dépôt, ou sous le contrôle le plus bas du Détail
  const onAdd = useCallback((f: SourceField, at?: { section: number; left: number; top: number }) => {
    const { state: s, readOnly: ro } = live.current;
    if (ro) return;
    const detail = Math.max(0, s.doc.sections.findIndex((x) => x.kind === 'detail'));
    const d = s.doc.sections[detail];
    const where = at ?? { section: detail, left: FIELD_LEFT, top: d && d.controls.length ? sectionBottomLimit(d) + FIELD_GAP : 0 };
    send({ type: 'insert', section: where.section, controls: boundControlWithLabel(s.doc, f, where, { objectKind: 'report', labelSuffix: t('designer.ctlPrefix.label') }) });
  }, [t]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeThemes = useCallback(() => setThemesOpen(false), []);
  const closeColors = useCallback(() => setColorsOpen(false), []);
  const closeFonts = useCallback(() => setFontsOpen(false), []);
  const closeFormatMenu = useCallback(() => setFormatMenu(null), []);
  const closeLayoutMenu = useCallback(() => setLayoutMenu(null), []);
  const closePageMenu = useCallback(() => setPageMenu(null), []);
  const closeSheet = useCallback(() => setSheetVisible(false), []);
  const closeTotals = useCallback(() => setTotalsMenu(false), []);
  const closeGrouping = useCallback(() => setGrouping(false), []);
  useEffect(() => { if (readOnly) setPageMenu(null); }, [readOnly]);
  useEffect(() => setTotalsMenu(false), [totalKey, readOnly]);   // une autre sélection : le menu ne vaut plus

  // L3, mode Page : le même concepteur (état du réducteur, modifications, annulations) sur le flux mis en page avec les données ;
  // ni événement ni macro (useReportFlow), rien n'est écrit tant que l'utilisateur ne modifie rien
  const layout = tab.mode === 'layout';
  const view = reportView(tab.mode);
  const { flow, busy: flowBusy } = useReportFlow(state.doc, layout && phase === 'ready', theme);
  useEffect(() => { if (layout) setTool({ kind: null, locked: false }); }, [layout]);   // l'outil ne passe pas d'un mode à l'autre
  const noticeKey = layoutNoticeKey(flow.notice, !!sourceError);
  const canvas = view.canvas === 'flow'
    ? (c: CanvasProps) => <ReportLayoutCanvas {...c} flow={flow} busy={flowBusy} notice={noticeKey} />
    : undefined;

  if (typeof phase === 'object') {
    return (
      <div className="doc-empty muted" role="alert" data-testid="report-design-error">
        <p>{phase.error}</p>
        {phase.list && <ul>{phase.list.map((x) => <li key={x}>{x}</li>)}</ul>}
      </div>
    );
  }
  if (phase === 'loading' || region === null) return <div className="rd" ref={root} />;
  return (
    <DocThemeProvider docProps={state.doc.props} mode="light">
    <div className="rd" ref={root} data-testid="report-design">
      {sourceError && <div className="rd-banner" role="status" data-testid="report-source-error">{sourceError}</div>}
      {/* en Page : pas de surface de section, donc ni menu contextuel de section ni dépôt de la Liste des champs (Global Constraints) */}
      <Designer state={state} dispatch={guarded} host={host} readOnly={readOnly} tool={tool} onTool={setTool} sheetVisible={sheetVisible} onSheetClose={closeSheet}
        side={fieldList && !layout && <FieldList fields={fields} readOnly={readOnly} onAdd={onAdd} />} restrict={view.restrict} canvas={canvas} />
      {grouping && !layout && <GroupingPane doc={state.doc} fields={fields} display={display} readOnly={readOnly} dispatch={guarded} onClose={closeGrouping} />}
      <ReportIssues issues={issues} />
      {menu && <ArrangePopup menu={menu} state={state} dispatch={guarded} onClose={closeMenu} readOnly={readOnly} />}
      {layoutMenu && <LayoutPopupMenu key={layoutMenu} id={layoutMenu} state={state} dispatch={guarded} onClose={closeLayoutMenu} readOnly={readOnly} />}
      {themesOpen && <ThemeGallery kind="report" dispatch={guarded} appDispatch={dispatch} onClose={closeThemes} readOnly={readOnly} />}
      {colorsOpen && <ColorsGallery kind="report" appDispatch={dispatch} dispatch={guarded} onClose={closeColors} readOnly={readOnly} />}
      {fontsOpen && <FontsGallery kind="report" appDispatch={dispatch} dispatch={guarded} onClose={closeFonts} readOnly={readOnly} />}
      {formatMenu && <FormatPopup id={formatMenu} state={state} dispatch={guarded} docKind="report" sectionLabel={host.sectionLabel} onClose={closeFormatMenu} readOnly={readOnly} />}
      {pageMenu && <PageSetupMenu menu={pageMenu} page={readReport(state.doc, []).page} onClose={closePageMenu}
        onPick={(v) => (v === 'custom' ? void cmds.current.pageSetupDialog() : setup(v))} />}
      {totalsMenu && totalKey && !readOnly && (
        <RibbonPopup anchor="reportTotals" testId="totals-popup" labelKey="ribbon.cmd.reportTotals" onClose={closeTotals}>
          {TOTAL_FNS.map((fn) => (
            <button key={fn} type="button" role="menuitem" data-testid={`totals-popup-${fn}`} onClick={() => { closeTotals(); total(fn); }}>{t(`report.totals.${fn}`)}</button>
          ))}
        </RibbonPopup>
      )}
      <input ref={logoInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" data-testid="report-logo-file"
        onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
    </DocThemeProvider>
  );
}
