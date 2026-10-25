// Aperçu avant impression d'un état (mode Exécution) : lecture de la définition et des données, mise en page par le moteur
// partagé, pages HTML positionnées (renderPageHtml), une ou deux pages, zoom, navigation, avertissements, mise en page.
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc } from '../../shared/design/model';
import { cssFamily, resolveFont } from '../../shared/fonts';
import { layoutReport } from '../../shared/report/layout';
import { pageGeometry, readReport, type PageSetup, type ReportIssue } from '../../shared/report/model';
import { renderPageHtml, reportCss } from '../../shared/report/render';
import type { LaidOutPage, LaidOutReport, LayoutEnv, ReportData } from '../../shared/report/types';
import { api } from '../bridge';
import { i18n } from '../i18n';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage as dialogError, useModal, type ModalApi } from '../shell/Modal';
import { RibbonPopup } from '../designer/RibbonPopup';
import { exportSource } from '../exchange/export';
import { registerCommandStates, registerCommands } from '../shell/ribbon-model';
import { localeInfo } from '../../shared/locale-format';
import { promptParameters } from '../query/prompt-parameters';
import { docParameters, loadDocData, loadReportDoc, printRequestFor, ReportLoadError, zoomFor, type AskParameters } from './load';
import { orientationStates, withPageSetup } from './page-setup';
import { PageSetupDialog, PageSetupMenu } from './PageSetupDialog';
import './preview.css';

/** Tabs whose preview was entered from Design view (the designer adds its tab when it lets the change of mode through):
 *  Close Preview goes back to Design view for them, and closes the tab otherwise (spec contextual tabs 4.6). */
export const previewFromDesign = new Set<string>();
type PerView = 1 | 2 | 4 | 8 | 12;
const MORE_PAGES = [4, 8, 12] as const;

/** The engine's warnings, folded under one line (Print Preview, and under the designer's canvas). */
export function ReportIssues({ issues }: { issues: ReportIssue[] }) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  return (
    <details className="rp-issues" data-testid="report-issues">
      <summary>{t('report.issues', { count: issues.length })}</summary>
      <ul>
        {issues.map((x, i) => (
          <li key={i}>{x.control && <b>{x.control} </b>}{t(`report.issue.${x.code}`, { detail: x.detail ?? '',
            section: t(`designer.section.${x.detail ?? ''}`, { defaultValue: x.detail ?? '' }) })}</li>
        ))}
      </ul>
    </details>
  );
}

/** `partial`: the pages laid out so far, shown while the layout goes on (no print, no export, no page count yet). */
type Phase = { k: 'loading' } | { k: 'error'; message: string; list?: string[] } | { k: 'ready'; report: LaidOutReport; partial?: true };
type Step = 'object' | 'data' | 'layout';
const PX_PER_TWIP = 1 / 15; // 96 px per inch, 1440 twips per inch
const GAP = 16; // px between two pages and around them

/** The CSS font shorthand of every face the pages draw, for document.fonts.load (a non-portable font draws Liberation Sans). */
const faces = (r: LaidOutReport) => new Set(r.pages.flatMap((p) => p.bands.flatMap((b) => b.items.flatMap((i) => {
  if (i.kind !== 'text') return [];
  const f = resolveFont(i.font.name);
  return [`${i.font.italic ? 'italic ' : ''}${i.font.bold ? 700 : 400} 12px "${cssFamily(f.portable ? f.family : 'Liberation Sans')}"`];
}))));

/** The layout environment of the preview, the print and the export: region and language of the settings, messages in the UI's. */
export async function layoutEnv(): Promise<LayoutEnv> {
  const s = await api.app.getSettings();
  return {
    locale: s.region, lang: s.uiLanguage, now: () => new Date(), errorText: { error: i18n.t('report.error'), name: i18n.t('report.name') },
    tick: () => new Promise((r) => setTimeout(r)),
  };
}

/** « Entrer une valeur de paramètre » for a report's record source (C3), checked in the region of the settings. */
export const askParameters = (modal: ModalApi): AskParameters => async (ps) => promptParameters(modal, ps, localeInfo((await api.app.getSettings()).region));

/** One print or export at a time, from the pane or the preview: a request while one runs is ignored (final review M8). */
let outputting = false;
export const outputBusy = (): boolean => outputting;

/** The progress box of a report being laid out for print or export: it closes itself with 'done' once laid out; Cancel or
 *  Escape close it with null, which aborts the layout. */
function OutputProgress({ job, close }: { job: Promise<unknown>; close(v: 'done' | null): void }) {
  const { t } = useTranslation();
  useEffect(() => {
    let on = true;
    job.then(() => on && close('done'), () => on && close('done'));
    return () => { on = false; };
  }, [job]);
  return (
    <>
      <p className="modal-message" role="status" data-testid="report-output-progress">{t('report.progress')}</p>
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="modal-btn-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </>
  );
}

/** A laid-out report to the PDF file chosen or to the printer (nothing is written into the base). `report` may lay it out
 *  first (the Navigation Pane's items), under a progress box that can cancel it. The job MUST call `ready()` once, as soon
 *  as it has its parameter values (after the prompts, before reading the rows): the box is shown only then, since the
 *  dialogs share one queue and a box shown earlier would hold the prompts behind it; a job that never calls it shows no
 *  box and cannot be cancelled. A loading failure shows its report.<code> text, the others their dialog.error text; an
 *  AbortError (Cancel on a parameter prompt) ends it without a message. */
export async function outputReport(modal: ModalApi, name: string,
  report: LaidOutReport | ((signal: AbortSignal, ready: () => void) => Promise<LaidOutReport>), to: 'pdf' | 'printer') {
  if (outputting) return;
  outputting = true;
  try {
    let r: LaidOutReport;
    if (typeof report === 'function') {
      const ac = new AbortController();
      let settle!: () => void;
      const settled = new Promise<void>((s) => { settle = s; });
      const job = report(ac.signal, () => void modal.custom<'done'>((close) => <OutputProgress job={settled} close={close} />, { titleKey: 'report.preparing' })
        .then((v) => { if (v !== 'done') ac.abort(); }));
      job.then(settle, settle);
      r = await job;
      if (ac.signal.aborted) return;   // canceled: never the Save or Print dialog, even if the layout ended after the Cancel
    } else r = report;
    const req = printRequestFor(r, name);
    if (to === 'printer') await api.reports.print(req);
    else if (await api.reports.exportPdf(req) === 'saved') {
      await modal.confirm({ titleKey: 'ribbon.cmd.exportPdf', messageKey: 'report.pdfSaved', buttons: ['ok'] });
    }
  } catch (e) {
    if ((e as Error | null)?.name === 'AbortError') return;   // canceled in the progress box
    // bc:fontMissing, bc:writeFailed, bc:printFailed; bc:notFound… for a report laid out here; tooLarge, tooManyPages
    const m = e instanceof ReportLoadError ? { key: `report.${e.code}`, params: {} } : dialogError(e);
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] });
  } finally {
    outputting = false;
  }
}

export function ReportPreviewView({ tab, active, dispatch }: DocViewProps) {
  const { t } = useTranslation();
  const modal = useModal();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [runs, setRuns] = useState(0); // completed layouts (data-runs: lets a test see a refresh)
  const [fontsReady, setFontsReady] = useState(false);
  const [first, setFirst] = useState(0);
  const [perView, setPerView] = useState<PerView>(1);
  const [menu, setMenu] = useState<'margins' | 'pageSize' | 'morePages' | null>(null);
  const [zoom, setZoom] = useState<'fitPage' | 'actual'>('fitPage');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<string | null>(null); // the page number being typed; null: the current page's
  const doc = useRef<DesignDoc | null>(null);
  const data = useRef<ReportData | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  /** Loads from `from` on: the definition, then the data, then the layout. A newer run (or closing the tab) aborts it. */
  const run = async (from: Step) => {
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    const live = () => !ac.signal.aborted;
    const before = { phase, data: data.current };
    let cleared = false;
    try {
      // Refresh (Shift+F9) of a definition already read: its parameters are asked while the pages are still shown
      const kept = from === 'data' ? doc.current : null;
      const asked = kept ? await docParameters(api, kept, askParameters(modal)) : undefined;
      if (!live()) return;
      cleared = true;
      setPhase({ k: 'loading' });
      setFontsReady(false);
      if (from === 'object' || !doc.current) {
        doc.current = null; // a definition that can no longer be read is never saved back by Page Setup
        data.current = null;
        const def = await loadReportDoc(api, tab.name);
        if (!live()) return;
        doc.current = def;
      }
      const d = doc.current;
      if (from !== 'layout' || !data.current) {
        data.current = null;
        const params = kept ? asked : await docParameters(api, d, askParameters(modal));
        if (!live()) return;
        const rows = await loadDocData(api, d, params, ac.signal, tab.openArgs?.where);   // OpenReport's Where Condition (R8)
        if (!live()) return;
        data.current = rows;
      }
      const env = await layoutEnv();
      if (!live()) return;
      const spec = readReport(d, data.current.fields), { width, height } = pageGeometry(spec.page);
      let shownAt = 0;
      const onPage = (pages: LaidOutPage[]) => {   // page 1 at once, then at most twice a second
        if (pages.length > 1 && Date.now() - shownAt < 500) return;
        shownAt = Date.now();
        setPhase({ k: 'ready', report: { width, height, pages: pages.slice(), issues: [] }, partial: true });
      };
      const report = await layoutReport(spec, data.current, { ...env, signal: ac.signal, onPage: (p) => live() && onPage(p) });
      if (!live()) return;
      setFirst((f) => Math.max(0, Math.min(f, report.pages.length - 1)));
      setPhase({ k: 'ready', report });
      setRuns((n) => n + 1);
    } catch (e) {
      if (!live()) return;   // a newer run, or the tab closed
      if ((e as Error | null)?.name === 'AbortError') {   // Cancel on a parameter prompt: opening, the preview closes; else it stays as it was
        if (from === 'object') closePreview();
        else if (cleared) { data.current = before.data; setPhase(before.phase); }
        return;
      }
      if (e instanceof ReportLoadError) setPhase({ k: 'error', message: t(`report.${e.code}`), list: e.list });
      else { const m = dialogError(e); setPhase({ k: 'error', message: t(m.key, m.params) }); }
    }
  };

  /** Back to Design view when entered from it, else the tab closes. */
  const closePreview = () => {
    if (previewFromDesign.delete(tab.id)) dispatch({ type: 'setMode', id: tab.id, mode: 'design' });
    else dispatch({ type: 'close', id: tab.id });
  };

  /** Page Setup dialog, Margins, Size, Portrait, Landscape: saved into the definition, then laid out again. */
  const applySetup = async (patch: Partial<PageSetup>) => {
    const d = doc.current;
    if (!d) return;
    const def = withPageSetup(d, patch);
    if (def === d) return;
    const r = await api.objects.save('report', tab.name, def, tab.name);
    if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return; }
    doc.current = def;
    await run('layout');
  };
  const pageSetup = async () => {
    const d = doc.current;
    if (!d) return;
    const next = await modal.custom<PageSetup>((close) => <PageSetupDialog initial={readReport(d, []).page} onClose={close} />,
      { titleKey: 'report.pageSetup.title' });
    if (next) await applySetup(next);
  };

  /** The laid-out report as it is shown, to the PDF file chosen or to the printer. */
  const output = async (to: 'pdf' | 'printer') => {
    if (phase.k === 'ready') await outputReport(modal, tab.name, phase.report, to);
  };

  /** Print Preview › Text File: the report's record source (a parameter query asks for its values), not the formatted pages. */
  const exportData = async (format: 'text' | 'excel') => {
    const src = doc.current?.recordSource;
    if (!src) {
      if (doc.current) await modal.confirm({ titleKey: format === 'excel' ? 'ribbon.cmd.exportExcel' : 'ribbon.cmd.exportText', messageKey: 'exchange.noSource', buttons: ['ok'] });
      return;
    }
    const where = tab.openArgs?.where;   // OpenReport's Where Condition: the export has the preview's rows
    await exportSource(modal, { ref: src, ...(where !== undefined ? { where } : {}) }, tab.name, format);
  };

  const cmds = useRef({ run, pageSetup, applySetup, output, closePreview, exportData });
  cmds.current = { run, pageSetup, applySetup, output, closePreview, exportData };

  useEffect(() => {
    void cmds.current.run('object');
    return () => ctl.current?.abort();
  }, [tab.name, tab.reloadToken]);

  const ready = phase.k === 'ready' && !phase.partial;
  useEffect(() => registerCommands(tab.id, {
    refresh: () => cmds.current.run('data'), // Shift+F9 (C5): the data again, then the layout
    onePage: () => setPerView(1),
    twoPages: () => setPerView(2),
    morePages: () => setMenu((m) => (m === 'morePages' ? null : 'morePages')),
    previewZoom: () => setZoom((z) => (z === 'actual' ? 'fitPage' : 'actual')),
    pageSetupDialog: () => cmds.current.pageSetup(),
    portrait: () => cmds.current.applySetup({ orientation: 'portrait' }),
    landscape: () => cmds.current.applySetup({ orientation: 'landscape' }),
    margins: () => setMenu((m) => (m === 'margins' ? null : 'margins')),
    pageSize: () => setMenu((m) => (m === 'pageSize' ? null : 'pageSize')),
    exportText: () => cmds.current.exportData('text'), // always registered: the shell's handler would export the pane's selection
    exportExcel: () => cmds.current.exportData('excel'),
    closePreview: () => cmds.current.closePreview(),
    // only once laid out: until then the two commands show disabled
    ...(ready ? { print: () => cmds.current.output('printer'), exportPdf: () => cmds.current.output('pdf') } : {}),
  }), [tab.id, dispatch, ready]);

  // Portrait / Landscape pressed as the definition's page setup says (the rule of Design view); none while loading
  const laid = phase.k === 'ready' ? phase.report : null;
  const orientation = useMemo(() => (laid && doc.current ? readReport(doc.current, []).page.orientation : null), [laid]);   // doc.current is set before each layout
  useEffect(() => (orientation ? registerCommandStates(tab.id, orientationStates(orientation)) : undefined), [tab.id, orientation]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const report = phase.k === 'ready' ? phase.report : null;
  const count = report?.pages.length ?? 0;
  const step = perView;
  const shown = useMemo(() => (report ? report.pages.slice(first, first + step) : []), [report, first, step]);
  // the pages drawn only: thousands of pages, shown as they are laid out, are never all scanned at each update
  const drawn = useMemo(() => (report ? { ...report, pages: shown } : null), [report, shown]);
  const css = useMemo(() => (drawn ? reportCss(drawn, 'fonts/') : ''), [drawn]);
  const fontList = useMemo(() => (drawn ? [...faces(drawn)].join('|') : null), [drawn]);

  // The pages stay hidden until their embedded fonts are loaded: never a frame drawn in a fallback font.
  useEffect(() => {
    if (fontList === null) return;
    const list = fontList ? fontList.split('|') : [];
    if (!list.every((f) => document.fonts.check(f))) setFontsReady(false);   // a page turned to a face not yet loaded
    let gone = false;
    void Promise.all(list.map((f) => document.fonts.load(f).catch(() => [])))
      .then(() => document.fonts.ready)
      .then(() => { if (!gone) setFontsReady(true); });
    return () => { gone = true; };
  }, [fontList]);

  useEffect(() => { if (active && report && fontsReady) viewport.current?.focus({ preventScroll: true }); }, [active, report, fontsReady]);

  const cols = perView <= 2 ? perView : perView / 2; // Access: 4, 8 and 12 pages on two rows
  const go = (i: number) => { const to = Math.max(0, Math.min(i, count - 1)); setFirst(to); setDraft(null); };
  const pw = (report?.width ?? 0) * PX_PER_TWIP, ph = (report?.height ?? 0) * PX_PER_TWIP;
  const across = Math.min(shown.length, cols), down = Math.ceil(shown.length / cols) || 1;
  const z = zoomFor(zoom, { w: across * pw + (across - 1) * GAP, h: down * ph + (down - 1) * GAP }, { w: size.w - 2 * GAP, h: size.h - 2 * GAP });

  const navBtn = (key: string, Icon: LucideIcon, to: number, disabled: boolean) => (
    <button className="iconbtn" data-testid={`preview-nav-${key}`} aria-label={t(`report.nav.${key}`)} title={t(`report.nav.${key}`)}
      disabled={!report || disabled} onClick={() => go(to)}>
      <Icon className="ic" aria-hidden />
    </button>
  );

  return (
    <div className="rp" data-testid="report-preview" data-runs={runs} aria-label={t('report.preview', { name: tab.name })} role="region">
      {report && <ReportIssues issues={report.issues} />}
      {report && <style>{css}</style>}
      <div ref={viewport} className="rp-viewport" tabIndex={0} data-testid="report-viewport"
        onKeyDown={(e) => {
          if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); go(first + (e.key === 'PageDown' ? step : -step)); }
        }}>
        {phase.k === 'loading' && <div className="rp-message" role="status" data-testid="report-progress">{t('report.progress')}</div>}
        {phase.k === 'error' && (
          <div className="rp-message rp-error" role="alert" data-testid="report-error">
            <p>{phase.message}</p>
            {phase.list && <ul>{phase.list.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        )}
        {report && (
          <div className="rp-spread" style={{ visibility: fontsReady ? 'visible' : 'hidden', gridTemplateColumns: `repeat(${across}, auto)` }}
            data-testid="report-pages" aria-busy={!fontsReady}>
            {shown.map((p) => (
              <div key={p.number} className="rp-sheet" style={{ width: pw * z, height: ph * z }}>
                {/* renderPageHtml escapes every text and attribute (Task 7); the UI's CSP forbids scripts */}
                <div style={{ transform: `scale(${z})`, transformOrigin: '0 0' }} dangerouslySetInnerHTML={{ __html: renderPageHtml(p, report) }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="recnav rp-nav" role="group" aria-label={t('report.nav.page')}>
        {navBtn('first', ChevronFirst, 0, first === 0)}
        {navBtn('prev', ChevronLeft, first - step, first === 0)}
        <span className="recpos">
          <input data-testid="preview-nav-page" aria-label={t('report.nav.page')} inputMode="numeric" value={draft ?? String(first + 1)} disabled={!report}
            onChange={(e) => setDraft(e.target.value)} onBlur={() => setDraft(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const n = Number(draft ?? first + 1);
              go(Number.isInteger(n) ? n - 1 : first);
            }} />
        </span>
        {navBtn('next', ChevronRight, first + step, first + step >= count)}
        {navBtn('last', ChevronLast, count - 1, first >= count - 1)}
        <span data-testid="preview-page-of">{!report ? '' : phase.k === 'ready' && phase.partial ? t('report.pageFormatting', { page: first + 1 })
          : t('report.pageOf', { page: first + 1, pages: count })}</span>
      </div>
      {(menu === 'margins' || menu === 'pageSize') && doc.current && (
        <PageSetupMenu menu={menu} page={readReport(doc.current, []).page} onClose={() => setMenu(null)}
          onPick={(v) => void (v === 'custom' ? cmds.current.pageSetup() : cmds.current.applySetup(v))} />
      )}
      {menu === 'morePages' && (
        <RibbonPopup anchor="morePages" testId="preview-pages-menu" labelKey="ribbon.cmd.morePages" onClose={() => setMenu(null)}>
          {MORE_PAGES.map((n) => (
            <button key={n} type="button" role="menuitemradio" aria-checked={perView === n} data-testid={`preview-pages-${n}`}
              onClick={() => { setMenu(null); setPerView(n); }}>{t('report.perView', { count: n })}</button>
          ))}
        </RibbonPopup>
      )}
    </div>
  );
}
