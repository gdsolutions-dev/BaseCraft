// Pagination d'un état (pur, déterministe, sans DOM) : tri et regroupement des lignes, suite des bandes, placement sur les
// pages (Garder ensemble, Répéter la section, Saut de page, coupe d'une bande plus haute que la place), en-tête et pied de
// page formatés à la fermeture de la page, deux passes quand un contrôle lit [Pages].
import { ExprRuntimeError, type Value } from '../expr/ast';
import { compare, evaluate } from '../expr/evaluate';
import { infoOf } from '../expr/library';
import type { LocaleInfo } from '../locale-format';
import { formatBand, type FormattedBand } from './band';
import { pageGeometry, type ReportIssue, type ReportSpec, type SectionSpec } from './model';
import { lineHeight } from './text';
import { rowField } from './totals';
import { ReportLoadError, type LaidOutBand, type LaidOutItem, type LaidOutPage, type LaidOutReport, type LayoutEnv, type ReportData } from './types';

/** Past this many pages the layout stops (tooManyPages): a definition gone wrong never fills the renderer's memory. */
export const MAX_PAGES = 10000;

/** A band to print: its section, its row (null for the report sections) and its total scope. */
interface Job { s: SectionSpec; row: number | null; scope: number[]; starts?: Span[] /* groups whose first band it is */; closes?: Span[] /* … last band */ }
/** A group of one level: its bands are jobs[first..last]; `scope` is the one array every band of the group passes to formatBand. */
interface Span { level: number; first: number; last: number; firstDetail: number; scope: number[]; header?: Job }
interface Page { number: number; bands: LaidOutBand[]; y: number; phTop: number | null /* null: not yet reserved (page 1) */; body: boolean;
  first: number | null; last: number | null /* rows of its first and last Detail */ }

/** Awaits `env.tick` every 200 calls, then throws an AbortError once `env.signal` is aborted. */
function heartbeat(env: LayoutEnv): () => Promise<void> {
  let n = 0;
  return async () => {
    if (n++ % 200 !== 0) return;
    await env.tick?.();
    if (env.signal?.aborted) throw Object.assign(new Error('Report layout aborted'), { name: 'AbortError' });
  };
}

/** Group key order: Null first, then `compare` in the region (case ignored); two values it cannot compare order by type. */
function keyCompare(a: Value, b: Value, info: LocaleInfo): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  try { return compare(a, b, info) ?? 0; } catch (e) {
    if (!(e instanceof ExprRuntimeError)) throw e;
    return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
  }
}

/**
 * The report order of the rows, and for each position in it the key of each grouping level: `keys[i][L]` belongs to row
 * `order[i]`. A key is a field or an expression evaluated on the row; an error gives Null. The sort is stable, level by
 * level, with `compare` in the region: Null first ascending and last descending, ties in source order.
 */
export async function sortAndGroup(spec: ReportSpec, data: ReportData, env: LayoutEnv): Promise<{ order: number[]; keys: Value[][] }> {
  const info = infoOf(env.locale), beat = heartbeat(env), byRow: Value[][] = [];
  for (const row of data.rows) {
    await beat();
    const field = rowField(data.fields, row);
    const keys: Value[] = [];
    for (const { key } of spec.grouping) {
      try { keys.push(key.kind === 'field' ? field(key.name) : key.kind === 'expr' ? await evaluate(key.expr, { now: () => env.now(), locale: env.locale, lang: env.lang, field }) : null); }
      catch (e) { if (!(e instanceof ExprRuntimeError)) throw e; keys.push(null); }
    }
    byRow.push(keys);
  }
  const order = data.rows.map((_, i) => i).sort((x, y) => {
    for (const [L, level] of spec.grouping.entries()) {
      const c = keyCompare(byRow[x]![L] ?? null, byRow[y]![L] ?? null, info);
      if (c !== 0) return level.order === 'desc' ? -c : c;
    }
    return x - y;
  });
  return { order, keys: order.map((i) => byRow[i]!) };
}

/**
 * The bands in print order: Report Header; for each row, the headers of the groups it starts (outermost first), its Detail,
 * the footers of the groups it ends (innermost first); Report Footer. A group of level L starts when key L or an outer key
 * changes (`compare` = 0 is equal); a level with neither header nor footer only sorts. A group's bands share one scope
 * array, the Detail its innermost group's, the report sections `order`: formatBand then computes each total once.
 */
function bandSequence(spec: ReportSpec, order: number[], keys: Value[][], info: LocaleInfo): Job[] {
  const n = order.length, levels = spec.grouping.length;
  // the outermost level whose key changes at position i (levels when none does)
  const brk = order.map((_, i) => {
    let L = 0;
    if (i > 0) while (L < levels && keyCompare(keys[i - 1]![L] ?? null, keys[i]![L] ?? null, info) === 0) L++;
    return L;
  });
  const grouped = spec.grouping.flatMap((_, L) => (spec.groupHeaders[L] || spec.groupFooters[L] ? [L] : [])), inner = [...grouped].reverse();
  const jobs: Job[] = [], spans: Span[] = [], open: Span[] = [];
  if (spec.reportHeader) jobs.push({ s: spec.reportHeader, row: null, scope: order });
  for (let i = 0; i < n; i++) {
    for (const L of grouped) {
      if (brk[i]! > L) continue;
      let end = i + 1;
      while (end < n && brk[end]! > L) end++;
      const sp: Span = { level: L, first: jobs.length, last: -1, firstDetail: -1, scope: order.slice(i, end) };
      spans.push(open[L] = sp);
      const h = spec.groupHeaders[L];
      if (h) jobs.push(sp.header = { s: h, row: order[i]!, scope: sp.scope });
    }
    if (spec.detail) {
      for (const L of grouped) if (open[L]!.firstDetail < 0) open[L]!.firstDetail = jobs.length;
      jobs.push({ s: spec.detail, row: order[i]!, scope: grouped.length > 0 ? open[grouped.at(-1)!]!.scope : order });
    }
    for (const L of inner) {
      if (i + 1 < n && brk[i + 1]! > L) continue;
      const f = spec.groupFooters[L];
      if (f) jobs.push({ s: f, row: order[i]!, scope: open[L]!.scope });
      open[L]!.last = jobs.length - 1;
    }
  }
  if (spec.reportFooter) jobs.push({ s: spec.reportFooter, row: null, scope: order });
  for (const sp of spans) if (sp.last >= sp.first) { (jobs[sp.first]!.starts ??= []).push(sp); (jobs[sp.last]!.closes ??= []).push(sp); }
  return jobs;
}

/** The items of band part [from, to), moved up by `from`: those that overlap it (the renderer clips them to the band), a
 *  text keeping only the lines that start in it. */
function slice(items: LaidOutItem[], from: number, to: number): LaidOutItem[] {
  const hit = (top: number, bottom: number) => top < to && (bottom > from || top >= from);
  return items.flatMap((i): LaidOutItem[] => {
    if (i.kind === 'line') return hit(Math.min(i.y1, i.y2), Math.max(i.y1, i.y2)) ? [{ ...i, y1: i.y1 - from, y2: i.y2 - from }] : [];
    if (!hit(i.top, i.top + i.height)) return [];
    if (i.kind !== 'text') return [{ ...i, top: i.top - from }];
    const inner = i.top + (i.border?.width ?? 0);
    return [{ ...i, top: i.top - from, lines: i.lines.filter((l) => inner + l.y >= from && inner + l.y < to) }];
  });
}

/** `cut`, moved up to the top of any text line it would go through, but never to `from` or above: the line moves whole. */
function lineSafe(items: LaidOutItem[], from: number, cut: number): number {
  for (let moved = true; moved;) {
    moved = false;
    for (const i of items) {
      if (i.kind !== 'text') continue;
      const inner = i.top + (i.border?.width ?? 0), lh = lineHeight(i.font);
      for (const l of i.lines) {
        const y = inner + l.y;
        if (y > from && y < cut && cut < y + lh) { cut = y; moved = true; }
      }
    }
  }
  return cut;
}

const issueKey = (i: ReportIssue) => JSON.stringify([i.code, i.control, i.detail]);
const uses = (s: SectionSpec | undefined, k: 'usesPage' | 'usesPages') => !!s?.controls.some((c) => c.source.kind === 'expr' && c.source[k]);

/**
 * Lays the report out on pages, in twips from the page's top left corner. One pass, or two when a control reads [Pages]
 * (pass 1 counts the pages, pass 2 prints "of N"; a third, the last, when widening text changed the count). Every band
 * goes through `formatBand` (which calls `onFormat`), every placed band part through `onPrint`; `env.tick` is awaited
 * every 200 bands and `env.signal` stops the layout with an AbortError.
 */
export async function layoutReport(spec: ReportSpec, data: ReportData, env: LayoutEnv): Promise<LaidOutReport> {
  const { order, keys } = await sortAndGroup(spec, data, env);
  const jobs = bandSequence(spec, order, keys, infoOf(env.locale));
  const g = pageGeometry(spec.page), width = Math.min(spec.width, g.printableWidth);
  // the Page Header and Page Footer never grow: their design height is reserved on every page
  const reserved = (s?: SectionSpec) => (s?.visible ? s.height : 0);
  const phH = reserved(spec.pageHeader), pfH = reserved(spec.pageFooter);
  const usable = g.printableHeight - phH - pfH, limit = g.bodyTop + g.printableHeight - pfH;

  const pass = async (total: number | null): Promise<{ pages: LaidOutPage[]; issues: Map<string, ReportIssue> }> => {
    const beat = heartbeat(env), issues = new Map<string, ReportIssue>(), times = new Map<Job, number>();
    const pages: LaidOutPage[] = [], active: (Span | undefined)[] = [];   // per level: the group whose header is placed and footer not yet
    const fresh = (number: number): Page => ({ number, bands: [], y: g.bodyTop, phTop: null, body: false, first: null, last: null });
    let pg = fresh(1), after = false;

    const format = async (job: Job): Promise<FormattedBand | null> => {
      await beat();
      const formatCount = (times.get(job) ?? 0) + 1;
      times.set(job, formatCount);
      const f = await formatBand(job.s, data, { row: job.row, scope: job.scope, page: pg.number, pages: total, formatCount }, env);
      for (const i of f?.issues ?? []) issues.set(issueKey(i), i);
      return f;
    };
    const remaining = () => limit - pg.y - (pg.phTop === null ? phH : 0);
    const reservePH = () => { if (pg.phTop === null) { pg.phTop = pg.y; pg.y += phH; } };
    /** Part [from, to) of `f` at `top`: `onPrint` sees it on this page, and a cancel leaves its space empty. */
    const band = async (f: FormattedBand, job: Job, top: number, from: number, to: number, flag?: 'repeated' | 'continued'): Promise<LaidOutBand> => {
      const b: LaidOutBand = { section: job.s.kind, ...(job.s.groupLevel === undefined ? {} : { groupLevel: job.s.groupLevel }), top, left: g.bodyLeft, width,
        height: to - from, back: job.s.back, ...(flag === 'repeated' ? { repeated: true as const } : flag === 'continued' ? { continued: true as const } : {}),
        items: from === 0 && to >= f.height ? f.items : slice(f.items, from, to) };
      f.event.page = pg.number; f.event.cancel = false;
      await env.hooks?.onPrint?.(f.event);
      if (f.event.cancel) b.items = [];
      return b;
    };
    /** A body band part at the cursor; a repeated header leaves the page empty. */
    const put = async (f: FormattedBand, job: Job, from: number, to: number, flag?: 'repeated' | 'continued') => {
      pg.bands.push(await band(f, job, pg.y, from, to, flag));
      pg.y += to - from;
      if (flag !== 'repeated') pg.body = true;
      if (job.s.kind === 'detail') { pg.first ??= job.row; pg.last = job.row; }
    };
    /** Page Header (row: the page's first Detail) and Page Footer (its last), formatted now that the page is complete. */
    const close = async () => {
      reservePH();
      for (const [s, top, row, h] of [[spec.pageHeader, pg.phTop!, pg.first, phH], [spec.pageFooter, limit, pg.last, pfH]] as const) {
        if (!s) continue;
        const job: Job = { s, row, scope: order }, f = await format(job);
        if (f) pg.bands.push(await band(f, job, top, 0, h));
      }
      pages.push({ number: pg.number, bands: pg.bands.sort((a, b) => a.top - b.top) });
    };
    /** Closes the page and opens the next: Page Header, then the open groups' Repeat Section headers, outermost first. */
    const newPage = async () => {
      await beat();
      if (pages.length + 1 >= MAX_PAGES) throw new ReportLoadError('tooManyPages');
      await close();
      pg = fresh(pages.length + 1);
      reservePH();
      for (const sp of active) {
        if (!sp?.header?.s.repeatSection) continue;
        const f = await format(sp.header);
        if (f && f.height <= remaining()) await put(f, sp.header, 0, f.height, 'repeated');
      }
    };
    /** Moves a band not yet placed to a new page, formatted again there when it reads [Page] (null: it no longer prints). */
    const moveOn = async (job: Job, f: FormattedBand) => { await newPage(); return uses(job.s, 'usesPage') ? format(job) : f; };
    /** Places `f` at the cursor: whole, else on a new page (Keep Together, page break at its top), else cut page after page. */
    const place = async (job: Job, f: FormattedBand) => {
      let from = 0, keep = job.s.keepTogether, top = f.breaks.some((p) => p <= 0), flag: 'continued' | undefined;
      for (;;) {
        await beat();   // a band cut over many pages (a long memo) still yields and can be aborted
        const end = Math.min(f.height, ...f.breaks.filter((p) => p > from)), room = remaining();
        const fits = end - from <= room || end === from;
        if (from === 0 && pg.body && (top || (!fits && keep && end <= usable))) {
          top = keep = false;
          const again = await moveOn(job, f);
          if (!again) return;
          f = again; continue;
        }
        if (fits) {
          await put(f, job, from, end, flag);
          if ((from = end) >= f.height) return;
          await newPage(); flag = 'continued';   // a page break control
          continue;
        }
        let cut = f.cuts.filter((c) => c > from && c <= from + room).at(-1);
        if (cut === undefined) {
          if (pg.body) { const again = await moveOn(job, f); if (!again) return; f = again; continue; }   // from is 0: a cut part opens a page
          // an empty page: cut at its bottom, never through a line of text, always at least one twip further
          cut = room > 0 ? lineSafe(f.items, from, from + room) : end;
        }
        await put(f, job, from, cut, flag);
        from = cut; flag = 'continued';
        await newPage();
      }
    };
    /** Group Keep Together, before the group's first band: if the group (or its header and first Detail, when the group is
     *  taller than a page) does not fit what is left but fits an empty page, the group starts a new page. */
    const keepGroup = async (sp: Span) => {
      const mode = spec.grouping[sp.level]!.keepTogether;
      if (mode === 'no' || !pg.body) return;
      const room = remaining();
      const height = async (last: number) => {   // stops as soon as it is taller than a page
        let h = 0;
        for (let k = sp.first; k <= last && h <= usable; k++) h += (await format(jobs[k]!))?.height ?? 0;
        return h;
      };
      let h = mode === 'wholeGroup' ? await height(sp.last) : Infinity;
      if (h > usable) h = await height(sp.firstDetail >= 0 ? sp.firstDetail : sp.last);
      if (h > room && h <= usable) await newPage();
    };

    for (const job of jobs) {
      if (job.s.kind !== 'reportHeader') reservePH();   // page 1: the Report Header comes before the Page Header
      for (const sp of job.starts ?? []) await keepGroup(sp);
      // a band that does not print neither opens a page nor uses up a pending break
      const force = job.s.forceNewPage;
      let f = await format(job);
      if (f && (after || force === 'before' || force === 'beforeAndAfter') && pg.body) f = await moveOn(job, f);
      if (f) {
        const { height } = f;
        await place(job, f);
        after = force === 'after' || force === 'beforeAndAfter' || f.breaks.some((p) => p >= height);
      }
      for (const sp of job.starts ?? []) if (sp.header === job) active[sp.level] = sp;
      for (const sp of job.closes ?? []) active[sp.level] = undefined;
    }
    await close();
    return { pages, issues };
  };

  let r = await pass(null);
  const all = [spec.reportHeader, spec.pageHeader, ...spec.groupHeaders, spec.detail, ...spec.groupFooters, spec.pageFooter, spec.reportFooter];
  if (all.some((s) => uses(s, 'usesPages'))) {
    const first = r.pages.length;
    r = await pass(first);
    if (r.pages.length !== first) r = await pass(r.pages.length);   // only widening text changes the count: this pass is the last
  }
  const issues = new Map(spec.issues.map((i) => [issueKey(i), i]));
  for (const [k, i] of r.issues) if (!issues.has(k)) issues.set(k, i);
  return { width: g.width, height: g.height, pages: r.pages, issues: [...issues.values()] };
}
