// Report events (B2): On Open, On No Data and On Close of a report, each section's On Format and On Print as the layout's
// hooks (A5), run by the shell (runEvent, R6); [Reports]![R]![C] while the report is laid out (R11). R9: what a macro sets in
// On Format / On Print applies to the band being formatted only, every band starting from the design values.
import { readEvent, sectionName, type EventBinding, type EventName } from '../../shared/design/events';
import type { DesignDoc } from '../../shared/design/model';
import { ExprRuntimeError, type Value } from '../../shared/expr/ast';
import { fail } from '../../shared/expr/library';
import { sameName } from '../../shared/field-types';
import type { LayoutHooks, SectionEvent } from '../../shared/report/types';
import { registerReport } from '../form/form-instances';
import { runEvent } from '../macro/macro-shell';

export interface ReportEvents {
  /** On Open, before the parameters and the rows; true when cancelled (or when the report was closed meanwhile: On Close then
   *  runs once On Open is done). */
  open(): Promise<boolean>;
  /** On No Data, when the source has no rows; true when cancelled (the report closes, as On Open cancelled: no On Close). */
  noData(): Promise<boolean>;
  /** On Close, once, when the report opened (On Open and On No Data not cancelled): the preview closes, a print or export ends.
   *  It waits for the report's event macros still running (a message box in On Format), never runs inside them. */
  close(): Promise<void>;
  /** Always `onBand` ([Reports]! reads the band being formatted); `onFormat` / `onPrint` only when a section has a macro for it. */
  hooks: LayoutHooks;
  /** An On No Data, On Format or On Print macro: they may show message boxes while the report is laid out. */
  layoutMacros: boolean;
  /** [Reports]![name]! reaches the band being formatted until the release (R11: while laid out). */
  register(): () => void;
}

const bound = (b: EventBinding): boolean => b.kind === 'macro' || b.kind === 'embedded';

/** A bare [Name] in a section's event (and [Reports]![R]![Name]): the band's control (read so far), else a field of its row. */
export function bandValue(e: SectionEvent, name: string): Value {
  const k = Object.keys(e.values).find((x) => sameName(x, name));
  return k === undefined ? e.field(name) : e.values[k] ?? null;
}

export function reportEvents(doc: DesignDoc, name: string): ReportEvents {
  let current: SectionEvent | null = null, state: 'new' | 'opening' | 'open' | 'closed' = 'new', registered = 0;
  let pending: Promise<unknown> = Promise.resolve();   // the event macros running
  const run = (binding: EventBinding, event: EventName, report?: SectionEvent): Promise<boolean> => {
    const p = runEvent(binding, {
      object: { kind: 'report', name }, event, field: (n) => (report ? bandValue(report, n) : fail('unknownField')),
      cancellable: event !== 'OnClose', cancelled: false, ...(report ? { report } : {}),
    });
    pending = pending.then(() => p).then(() => {}, () => {});   // each in turn: one failing never cuts the wait for another
    return p;
  };
  const own = (event: EventName) => readEvent(doc.props[event]);
  const isClosed = () => state === 'closed';   // read after an await (TS keeps the narrowing)
  const closeNow = async () => { await pending; await run(own('OnClose'), 'OnClose'); };
  /** The hook of `event`, absent when no section has a macro for it (the layout is then the one without events). */
  const hook = (event: 'OnFormat' | 'OnPrint') => {
    const of = new Map(doc.sections.map((s) => [sectionName(s.kind, s.groupLevel), readEvent(s.props[event])] as const).filter(([, b]) => bound(b)));
    return of.size === 0 ? undefined : async (e: SectionEvent) => {
      current = e;   // On Print: the band printed, maybe formatted before others (Keep Together)
      const b = of.get(sectionName(e.section, e.groupLevel));
      if (b && await run(b, event, e)) e.cancel = true;
    };
  };
  const onFormat = hook('OnFormat'), onPrint = hook('OnPrint');
  return {
    open: async () => {
      state = 'opening';
      const cancelled = await run(own('OnOpen'), 'OnOpen');
      if (isClosed()) { if (!cancelled) await closeNow(); return true; }   // closed while On Open ran
      state = cancelled ? 'closed' : 'open';
      return cancelled;
    },
    noData: async () => {
      const cancelled = await run(own('OnNoData'), 'OnNoData');
      if (cancelled) state = 'closed';
      return cancelled;
    },
    close: async () => {
      const was = state;
      state = 'closed';
      if (was === 'open') await closeNow();   // 'opening': open() runs it when On Open is done
    },
    hooks: { onBand: (e) => { current = e; }, ...(onFormat ? { onFormat } : {}), ...(onPrint ? { onPrint } : {}) },
    layoutMacros: !!onFormat || !!onPrint || bound(own('OnNoData')),
    register: () => {
      const release = registerReport({ name, value: (c) => {
        if (!current) throw new ExprRuntimeError('notOpen', name);
        return bandValue(current, c);
      } });
      registered++;
      let live = true;
      return () => {   // the band is forgotten with the last registration only (a print while the preview lays out)
        release();
        if (!live) return;
        live = false;
        if (--registered === 0) current = null;
      };
    },
  };
}

const waiting: { name: string; settle(ok: boolean): void }[] = [];

/** OpenReport in Print Preview: resolves once the preview has passed On Open and On No Data (or failed to load); rejects
 *  bc:actionCancelled when one of them cancels, or when the preview closes first (Access 2501). */
export function whenReportShown(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    waiting.push({ name, settle: (ok) => (ok ? resolve() : reject(new Error('bc:actionCancelled'))) });
  });
}

/** The preview of `name` is shown (`ok`) or will not be: settles its waiters; null: every waiter (the base closed or switched). */
export function reportShown(name: string | null, ok: boolean): void {
  for (let i = waiting.length - 1; i >= 0; i--) if (name === null || sameName(waiting[i]!.name, name)) waiting.splice(i, 1)[0]!.settle(ok);
}
