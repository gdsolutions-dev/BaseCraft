// Feuille de propriétés générique (formulaires A4, états A5), ancrée à droite du concepteur : liste « Sélection », type de la sélection,
// onglets Format / Données / Événement / Autres / Toutes, un éditeur par propriété du catalogue (data-testid prop-<Nom>).
// Une valeur refusée reste dans l'éditeur avec son message (role="alert") et le document ne change pas. Un brouillon encore ouvert quand
// sa ligne disparaît (autre sélection, autre onglet) est validé ; refusé, il est signalé en tête de la feuille (sheet-lost).
import { Ellipsis, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { colorCss, isColorValue, THEME_COLORS, type ColorValue } from '../../shared/design/colors';
import { flattenControls, type ControlDef, type SectionDef } from '../../shared/design/model';
import { PROPERTY_CATALOG, type PropertyDescriptor } from '../../shared/design/properties';
import { EMBEDDED_FONTS } from '../../shared/fonts';
import { sameName } from '../../shared/field-types';
import { parseNumber } from '../../shared/locale-format';
import type { RecordSourceRef } from '../../shared/record-source';
import { ExpressionBuilder } from '../expr/ExpressionBuilder';
import { ExpressionField } from '../expr/ExpressionField';
import { ComboBox } from '../shell/ComboBox';
import { useModal } from '../shell/Modal';
import type { DesignerAction, DesignerState } from './designer-model';
import { checkPropValue, columnWidthsToDisplay, columnWidthsToStored, controlSourceToCanonical, controlSourceToDisplay, fontWarning, fromSourceRef,
  MIXED, readProp, sheetRows, targetKind, targetsOf, toSourceRef, type SheetRow } from './property-sheet-model';
import type { PropertySheetContext, SheetTab } from './sheet-types';
import { formatCm, parseCm } from './units';

const TABS: SheetTab[] = ['format', 'data', 'event', 'other', 'all'];
const PICTURE_MAX = 1024 * 1024;
const descOf = (name: string): PropertyDescriptor => PROPERTY_CATALOG.find((d) => d.name === name)!;
type Parsed = { value: unknown } | { error: string };
/** Une valeur refusée dont la ligne a disparu : le libellé de la propriété et la clé du message. */
interface Lost { label: string; msg: string }

export function PropertySheet(p: { state: DesignerState; dispatch(a: DesignerAction): void; docKind: 'form' | 'report'; ctx: PropertySheetContext; readOnly: boolean;
  onClose?(): void; sectionLabel?(s: SectionDef, index: number): string }) {
  const { state, dispatch, docKind, ctx, readOnly } = p;
  const { t } = useTranslation();
  const uid = useId();
  const [tab, setTab] = useState<SheetTab>('all');
  const [lost, setLost] = useState<Lost | null>(null);
  const { doc } = state;
  const targets = useMemo(() => targetsOf(state.selection), [state.selection]);
  const rows = useMemo(() => sheetRows(doc, docKind, targets, tab, readOnly), [doc, docKind, targets, tab, readOnly]);
  const selKey = JSON.stringify(targets);   // une autre sélection, un autre onglet : de nouveaux éditeurs (un brouillon en cours est validé)

  const commit = (d: PropertyDescriptor, v: unknown): string | null => {
    for (const x of targets) { const e = checkPropValue(doc, x, d, v); if (e) return e; }
    dispatch({ type: 'setProp', targets, name: d.name, value: v });
    setLost(null);
    return null;
  };

  const objValue = state.selection.kind === 'doc' ? 'doc' : state.selection.kind === 'section' ? `s:${state.selection.index}`
    : state.selection.names.length === 1 ? `c:${state.selection.names[0]}` : state.selection.names.length ? 'multi' : 'doc';
  const pickObject = (v: string) => {
    if (v === 'doc') dispatch({ type: 'select', selection: { kind: 'doc' } });
    else if (v.startsWith('s:')) dispatch({ type: 'select', selection: { kind: 'section', index: Number(v.slice(2)) } });
    else if (v.startsWith('c:')) dispatch({ type: 'select', selection: { kind: 'controls', names: [v.slice(2)] } });
  };
  const k = targets.length > 1 ? null : targetKind(doc, docKind, targets[0]);
  const typeLabel = targets.length > 1 ? t('sheet.multiple') : targets[0].kind === 'doc' ? t(`tabs.kind.${docKind}`)
    : targets[0].kind === 'section' ? t('sheet.section') : t(`sheet.kind.${k}`);
  // Origine source d'une liste : table/requête (liste déroulante) ou liste de valeurs (texte)
  const rowSourceTable = targets.every((x) => x.kind === 'control' && readProp(doc, docKind, x, descOf('RowSourceType')) === 'tableQuery');

  /** Onglets ARIA : un seul arrêt de tabulation, Gauche/Droite/Début/Fin passent d'un onglet à l'autre. */
  const tabKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length]
      : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
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
        {doc.sections.map((s, i) => <option key={`s${i}`} value={`s:${i}`}>{p.sectionLabel ? p.sectionLabel(s, i) : t(`designer.section.${s.kind}`)}</option>)}
        {doc.sections.flatMap((s) => flattenControls(s.controls)).map((c) => <option key={`c:${c.name}`} value={`c:${c.name}`}>{c.name}</option>)}
      </select>
      <div className="dz-props-tabs" role="tablist" aria-label={t('sheet.title')} onKeyDown={tabKey}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" id={`${uid}-tab-${x}`} aria-selected={tab === x} aria-controls={`${uid}-panel`} tabIndex={tab === x ? 0 : -1}
            data-testid={`sheet-tab-${x}`} className={`dz-props-tab${tab === x ? ' is-active' : ''}`} onClick={() => setTab(x)}>{t(`sheet.tab.${x}`)}</button>
        ))}
      </div>
      {tab === 'event' && <p className="dz-props-hint" data-testid="sheet-events-later">{t('sheet.eventsLater')}</p>}
      {lost && <div className="dz-props-lost" role="alert" data-testid="sheet-lost">{t('sheet.lost', { name: lost.label })} {t(lost.msg)}</div>}
      <div className="dz-props-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
        {rows.map((row) => (
          <PropRow key={`${selKey}:${tab}:${row.d.name}`} row={row} id={`${uid}-${row.d.name}`} ctx={ctx} docKind={docKind} rowSourceTable={rowSourceTable}
            commit={(v) => commit(row.d, v)} onLost={(msg) => setLost({ label: t(row.d.labelKey), msg })} />
        ))}
      </div>
    </aside>
  );
}

interface RowProps { row: SheetRow; id: string; ctx: PropertySheetContext; docKind: 'form' | 'report'; rowSourceTable: boolean;
  commit(v: unknown): string | null; onLost(msg: string): void }

function PropRow({ row, id, ctx, docKind, rowSourceTable, commit, onLost }: RowProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const { d } = row;
  const mixed = row.value === MIXED;
  const v = mixed ? undefined : row.value;
  const testId = `prop-${d.name}`;
  const region = ctx.display.region;
  const aggregates = docKind === 'report';   // source contrôle seulement : un état a des groupes (A5) ; valeur par défaut et règle n'en ont jamais
  const text = (s: string): Parsed => ({ value: s.trim() === '' ? undefined : s.trim() });
  const field = (props: Omit<TextFieldProps, 'id' | 'testId' | 'label' | 'disabled' | 'mixed' | 'commit' | 'onLost'>) =>
    <TextField id={id} testId={testId} label={t(d.labelKey)} disabled={row.readOnly} mixed={mixed} commit={commit} onLost={onLost} {...props} />;

  let editor: ReactNode;
  if (d.editor === 'event') {
    editor = <input id={id} data-testid={testId} disabled value="" title={t('sheet.eventsLater')} />;
  } else if (d.name === 'ColumnWidths') {   // descripteur texte, montré en cm et stocké en twips (contrat 1.4)
    editor = field({ shown: columnWidthsToDisplay(typeof v === 'string' ? v : '', region), parse: (s) => {
      const w = columnWidthsToStored(s, region);
      return { value: w === '' ? undefined : w };   // null : illisible, refusé par checkPropValue
    } });
  } else {
    switch (d.editor) {
      case 'text': case 'fieldList':
        editor = field({ shown: v === undefined || v === null ? '' : String(v), parse: text });
        break;
      case 'number':
        editor = field({ shown: typeof v === 'number' ? String(v).replace('.', region.decimalSep) : '',
          parse: (s) => ({ value: s.trim() === '' ? undefined : parseNumber(s, region) ?? Number.NaN }) });
        break;
      case 'twips':
        editor = field({ shown: typeof v === 'number' ? formatCm(v, region) : '', parse: (s) => ({ value: s.trim() === '' ? undefined : parseCm(s, region) ?? Number.NaN }) });
        break;
      case 'font':
        editor = field({ shown: typeof v === 'string' ? v : '', options: EMBEDDED_FONTS.map((f) => f.family), parse: text, note: fontWarning });
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
          parse: (s) => { const ref = toSourceRef(s, ctx.tables, ctx.queries); return ref || !s.trim() ? { value: ref } : { error: 'sheet.error.unknownSource' }; } });
        break;
      case 'objectName':
        editor = field({ shown: typeof v === 'string' ? v : '', options: ctx.objects(docKind), parse: text });
        break;
      case 'rowSource':   // stocké en texte (Access) ; liste de valeurs : a;b;c, jamais entre guillemets (splitValueList)
        editor = field({ shown: typeof v === 'string' ? v : '', options: rowSourceTable ? [...ctx.tables, ...ctx.queries] : undefined, parse: text });
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
      case 'color': editor = <ColorEditor id={id} testId={testId} value={v} mixed={mixed} disabled={row.readOnly} commit={commit} />; break;
      case 'picture': editor = <PictureEditor id={id} testId={testId} value={v} mixed={mixed} disabled={row.readOnly} commit={commit} />; break;
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
    </div>
  );
}

/** Un brouillon validé à la sortie du champ, par Entrée, ou quand la ligne disparaît (une autre sélection) ; Échap l'abandonne.
 *  Un texte inchangé n'est jamais réécrit (l'affichage en cm perd de la précision). Un choix dans la liste est validé aussitôt.
 *  `build` : un bouton « … » (générateur d'expressions) dont le résultat est validé tel quel ; null = annulé. */
interface TextFieldProps { id: string; testId: string; label: string; disabled: boolean; mixed: boolean; shown: string; options?: string[];
  parse(text: string): Parsed; note?(text: string): string | null; build?(text: string): Promise<{ value: unknown } | null>;
  commit(v: unknown): string | null; onLost(msg: string): void }
function TextField({ id, testId, label, disabled, mixed, shown, options, parse, note, build, commit, onLost }: TextFieldProps) {
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
        <button type="button" className="iconbtn" data-testid={`${testId}-build`} disabled={disabled} aria-label={t('builder.title')} title={t('builder.title')}
          onMouseDown={(e) => e.preventDefault()} onClick={() => void openBuilder()}><Ellipsis className="ic ic-sm" aria-hidden /></button>
      )}
      {msg && <div id={msgId} className={error ? 'dz-perror' : 'dz-pnote'} role={error ? 'alert' : undefined} data-testid={`${testId}-${error ? 'error' : 'note'}`}>{t(msg)}</div>}
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
        fields={ctx.fields} disabled={disabled} error={code ?? undefined} placeholder={mixed ? t('sheet.mixed') : undefined} onCommit={(c) => commit(c)} onInvalid={setCode}
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

function PictureEditor({ id, testId, value, mixed, disabled, commit }: { id: string; testId: string; value: unknown; mixed: boolean; disabled: boolean;
  commit(v: unknown): string | null }) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const read = (f: File | undefined) => {
    if (!f) return;
    if (f.size > PICTURE_MAX) { setError('sheet.error.pictureTooLarge'); return; }
    const r = new FileReader();
    r.onload = () => { setError(commit(String(r.result))); };
    r.readAsDataURL(f);
  };
  const set = typeof value === 'string' && value !== '';
  return (
    <div className="dz-pfield">
      {set && value.startsWith('data:image/') && <img className="dz-pthumb" src={value} alt="" />}
      {mixed && <span className="dz-pmixed">{t('sheet.mixed')}</span>}
      <button type="button" id={id} data-testid={testId} className="dz-pbutton" disabled={disabled} aria-describedby={error ? `${id}-msg` : undefined}
        onClick={() => file.current?.click()}>{t('sheet.pickPicture')}</button>
      {(set || mixed) && (
        <button type="button" data-testid={`${testId}-clear`} className="dz-pbutton" disabled={disabled} onClick={() => { setError(null); commit(undefined); }}>
          {t('sheet.removePicture')}
        </button>
      )}
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" data-testid={`${testId}-file`}
        onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <div id={`${id}-msg`} className="dz-perror" role="alert" data-testid={`${testId}-error`}>{t(error)}</div>}
    </div>
  );
}

/** Échap ou un clic dehors referme le choix des couleurs ; le focus revient au bouton. */
function ColorEditor({ id, testId, value, mixed, disabled, commit }: { id: string; testId: string; value: unknown; mixed: boolean; disabled: boolean; commit(v: unknown): string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const label = mixed ? t('sheet.mixed') : isColorValue(value) ? (value.startsWith('theme:') ? t(`color.${value.slice(6)}`) : value) : String(value ?? '');
  return (
    <div ref={box} className="dz-pfield" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <button ref={button} type="button" id={id} data-testid={testId} className="dz-pcolor" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {!mixed && <i className="dz-swatch" style={{ background: colorCss(value) }} aria-hidden />}<span>{label}</span>
      </button>
      {open && !disabled && (
        <ColorChoices value={value} testId={`${testId}-colors`} onPick={(c) => { commit(c); setOpen(false); button.current?.focus(); }} />
      )}
    </div>
  );
}

const ROVE: Record<string, (i: number, n: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n, ArrowRight: (i, n) => (i + 1) % n, ArrowUp: (i, n) => (i + n - 1) % n, ArrowLeft: (i, n) => (i + n - 1) % n,
  Home: () => 0, End: (_i, n) => n - 1,
};

/** Les couleurs du thème (pastille et libellé color.<jeton>), puis « Couleur personnalisée… » (<input type="color"> natif, validé à sa fermeture).
 *  Un seul arrêt de tabulation (la couleur actuelle, sinon la première) ; Haut/Bas/Gauche/Droite/Début/Fin passent d'une pastille à l'autre.
 *  Réutilisé par l'onglet Format (tâche 5b). */
export function ColorChoices(p: { value: unknown; testId: string; onPick(v: ColorValue): void }) {
  const { t } = useTranslation();
  const custom = useRef<HTMLInputElement>(null);
  const hex = typeof p.value === 'string' && /^#[0-9a-f]{6}$/.test(p.value) ? p.value : null;
  const current = hex ? THEME_COLORS.length : Math.max(0, THEME_COLORS.findIndex((tok) => p.value === `theme:${tok}`));
  const [stop, setStop] = useState(current);
  const rove = (e: KeyboardEvent) => {
    const go = ROVE[e.key];
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button, input')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (!go || i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const next = go(i, items.length);
    setStop(next);
    items[next].focus();
  };
  const pick = useRef(p.onPick);
  pick.current = p.onPick;
  useEffect(() => {   // « change », pas « input » : un seul choix quand le sélecteur se ferme, pas un par mouvement
    const el = custom.current!;
    const h = () => pick.current(el.value.toLowerCase() as ColorValue);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, [hex]);   // l'élément est recréé quand la valeur change (key)
  return (
    <div className="dz-colors" role="group" aria-label={t('sheet.colors')} data-testid={p.testId} onKeyDown={rove}>
      {THEME_COLORS.map((tok, i) => (
        <button key={tok} type="button" aria-pressed={p.value === `theme:${tok}`} data-testid={`${p.testId}-${tok}`} tabIndex={i === stop ? 0 : -1}
          onClick={() => p.onPick(`theme:${tok}`)}>
          <i className="dz-swatch" style={{ background: colorCss(`theme:${tok}`) }} aria-hidden />{t(`color.${tok}`)}
        </button>
      ))}
      <label className="dz-color-custom">
        <i className="dz-swatch" style={{ background: hex ?? 'transparent' }} aria-hidden />{t('sheet.customColor')}
        <input ref={custom} key={hex ?? ''} type="color" defaultValue={hex ?? '#000000'} data-testid={`${p.testId}-custom`}
          tabIndex={stop === THEME_COLORS.length ? 0 : -1} />
      </label>
    </div>
  );
}
