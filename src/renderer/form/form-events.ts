// Les événements d'un formulaire en cours d'exécution (B2) : la macro de chaque propriété d'événement, exécutée par le shell
// (runEvent : à l'instant, imbriquée, R6). Les événements des contrôles (focus, mise à jour, clic, modification) passent l'un
// après l'autre, comme Access les déclenche de façon synchrone ; ceux qu'une macro d'événement provoque (AtteindreContrôle)
// passent dans une file à elle, imbriquée, que l'action attend. Il garde aussi les propriétés définies par macro (R9) et lit
// les valeurs du formulaire ([Formulaires]!, R11).
import type { SqlValue } from '../../shared/coerce';
import { CANCELLABLE, readEvent, type EventName } from '../../shared/design/events';
import { flattenControls, type ControlDef, type DesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { Value } from '../../shared/expr/ast';
import type { SourceInfo } from '../../shared/record-source';
import { runEvent } from '../macro/macro-shell';
import { controlValues, envValue, FAILED, fieldValues, type CalcResult, type CalcValue } from './calc';
import type { FormInstance, RecordTarget, SettableProperty } from './form-instances';
import { applies } from './run-model';
import type { FormRecords, RecordEvents } from './record-controller';

const NO_INFO: SourceInfo = { fields: [], updatable: false, parameters: [] };
/** A control event that throws (not a macro's failure: runEvent shows those): logged, and the chain goes on. */
const failed = (e: unknown): false => { console.error(e); return false; };

/** What the running view does for a macro's form actions (the registered instance passes them on). */
export type FormOps = Omit<FormInstance, 'name' | 'tabId' | 'value' | 'setProperty'>;
/** Runtime properties (R9), by control name: a ControlDef property (`Visible`…) or its geometry (`left`…), as stored. */
export type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
const PROPS: Partial<Record<SettableProperty, string>> = { enabled: 'Enabled', visible: 'Visible', locked: 'Locked', foreColor: 'ForeColor', backColor: 'BackColor', caption: 'Caption' };
const GEOMETRY = new Set(['left', 'top', 'width', 'height']);

/** The design with its runtime properties: copies of the controls that have some (the others, and their sections, unchanged). */
export function withOverrides(doc: DesignDoc, o: Overrides): DesignDoc {
  if (!Object.keys(o).length) return doc;
  const apply = (c: ControlDef): ControlDef => {
    const kids = c.children?.map(apply);
    const x = o[c.name];
    if (!x && (!kids || kids.every((k, i) => k === c.children![i]))) return c;
    const props = { ...c.props };
    const out: ControlDef = { ...c, props, ...(kids ? { children: kids } : {}) };
    for (const [k, v] of Object.entries(x ?? {})) {
      if (GEOMETRY.has(k)) (out as unknown as Record<string, unknown>)[k] = v; else props[k] = v;
    }
    return out;
  };
  return { ...doc, sections: doc.sections.map((s) => { const cs = s.controls.map(apply); return cs.every((c, i) => c === s.controls[i]) ? s : { ...s, controls: cs }; }) };
}

export class FormEvents {
  /** Set once On Open has let the form open. */
  records: FormRecords | null = null;
  /** The running view's values for a bare [Name] (the new record's defaults, unbound controls, calculated controls); before it
   *  shows, the record's. */
  view: { stored(): Record<string, SqlValue>; extra(): Record<string, CalcValue>; results(): Record<string, CalcResult> } | null = null;
  /** The running view's form actions (null until it shows). */
  form: FormOps | null = null;
  /** Resolves once the running view has shown (its form actions set): On Load runs then. */
  readonly shown: Promise<void>;
  private showDone: () => void = () => {};
  /** SetProperty's runtime properties (R9): they last until the form closes. */
  overrides: Overrides = {};
  private listeners = new Set<() => void>();
  private loaded = false;                                     // On Load done: On Current fires from then on
  private currentRun: Promise<boolean> = Promise.resolve(false);
  private chain: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private running = 0;
  private macros = 0;                                         // event macros of this form running
  private nested: Promise<unknown> = Promise.resolve();       // the control events raised by the innermost one (R6)
  private inserting: Promise<unknown> = Promise.resolve();
  private insertPending = false;
  private readonly all: ControlDef[];

  constructor(private readonly doc: DesignDoc, readonly name: string, private readonly base: { locale: string; lang: 'fr' | 'en'; now(): Date }) {
    this.all = doc.sections.flatMap((s) => flattenControls(s.controls));
    this.shown = new Promise((r) => { this.showDone = r; });
  }

  /** The form's (no control) or the control's property names a macro. */
  has(event: EventName, c?: ControlDef): boolean {
    const k = readEvent((c ?? this.doc).props[event]).kind;
    return k === 'macro' || k === 'embedded';
  }

  /** Runs the event's macro now; true when it cancels (R7). */
  raise(event: EventName, c?: ControlDef): Promise<boolean> {
    const binding = readEvent((c ?? this.doc).props[event]);
    if (binding.kind === 'none' || binding.kind === 'other') return Promise.resolve(false);
    const run = () => runEvent(binding, {
      object: { kind: 'form', name: this.name }, event, ...(c ? { control: c.name } : {}),
      field: (n) => this.value(n), cancellable: CANCELLABLE.has(event), cancelled: false,
    });
    // Before Insert runs on the first key typed: that key's On Change, queued meanwhile, comes after it (Access's order)
    return event === 'BeforeInsert' ? run() : this.inMacro(run);
  }

  /** While the macro runs, the control events it raises go to a chain of its own. ponytail: one chain per form; two event
   *  macros overlapping (two quick On Change, R6's cost) may restore each other's: only their order suffers. */
  private async inMacro(run: () => Promise<boolean>): Promise<boolean> {
    const outer = this.nested;
    this.macros++;
    this.nested = Promise.resolve();
    try { return await run(); } finally { this.macros--; this.nested = outer; }
  }

  /** A control's events, after those raised before them (and after a Before Insert under way). Raised by an event's macro (its
   *  GoToControl…): at once inside it, on that macro's own chain (R6), which `drain` gives. */
  serial(fn: () => Promise<boolean>): Promise<boolean> {
    if (this.macros > 0) {
      const run = this.nested.then(fn).catch(failed);
      this.nested = run;
      return run;
    }
    this.queued++;
    const run = this.chain.then(() => this.inserting).then(async () => {
      this.running++;
      try { return await fn(); } finally { this.running--; }
    }).catch(failed).finally(() => { this.queued--; });
    this.chain = run;
    return run;
  }

  /** What a save or a move asked by the user waits for first (null: nothing). Inside a control's event (its macro saving the
   *  record) nothing is waited for: the event would wait for itself. */
  idle(): Promise<unknown> | null {
    return this.running > 0 || this.macros > 0 || (!this.queued && !this.insertPending) ? null : this.chain.then(() => this.inserting);
  }
  /** A control's event is running (its macro asks for a save: the control's own events are not raised again). */
  get busy(): boolean { return this.running > 0; }
  /** The control events raised so far, from here (inside an event's macro: its own), done. ponytail: inside a Before Insert
   *  macro they wait for it to end, so they are not waited for (a GoToControl there goes on before the target's Enter); a
   *  nested chain for it when such macros need that order. */
  /** Inside a Before Insert macro (its control events wait for it to end). */
  get inInsert(): boolean { return this.macros === 0 && this.insertPending; }
  /** The running view has shown. */
  didShow(): void { this.showDone(); }
  drain(): Promise<unknown> { return this.macros > 0 ? this.nested : this.insertPending ? Promise.resolve() : this.chain; }

  /** SetProperty (R9, not `value`): kept until the form closes; throws bc:notFound||<name>, bc:propertyNotSupported. */
  setProperty(control: string, p: SettableProperty, v: Value): void {
    const c = this.all.find((x) => sameName(x.name, control));
    if (!c) throw new Error(`bc:notFound||${control}`);
    const key = PROPS[p] ?? (GEOMETRY.has(p) ? p : null);
    if (!key || (PROPS[p] && !applies(c, key))) throw new Error('bc:propertyNotSupported');
    this.overrides = { ...this.overrides, [c.name]: { ...this.overrides[c.name], [key]: v === null || v.t === 'empty' ? null : v.v } };
    this.listeners.forEach((l) => l());
  }
  subscribe(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  /** The record events, only those the form has (no After event: the controller keeps A4's timing). */
  recordEvents(): RecordEvents {
    const ok = (e: EventName) => async () => !(await this.raise(e));
    const done = (e: EventName) => async () => { await this.raise(e); };
    return {
      ...(this.has('BeforeInsert') ? {
        beforeInsert: () => {
          this.insertPending = true;
          const run = ok('BeforeInsert')();
          const over: Promise<void> = run.then(() => undefined, () => undefined).finally(() => { if (this.inserting === over) this.insertPending = false; });
          this.inserting = over;
          return run;
        },
      } : {}),
      ...(this.has('BeforeUpdate') ? { beforeUpdate: ok('BeforeUpdate') } : {}),
      ...(this.has('AfterUpdate') ? { afterUpdate: done('AfterUpdate') } : {}),
      ...(this.has('AfterInsert') ? { afterInsert: done('AfterInsert') } : {}),
      current: () => { if (this.loaded) this.currentRun = this.raise('OnCurrent'); },
    };
  }

  /** On Load done: the first On Current (the records' own came before On Load), then one for each record made current. */
  async start(): Promise<void> {
    this.loaded = true;
    if (this.records?.snapshot.status !== 'ready') return;
    this.currentRun = this.raise('OnCurrent');
    await this.currentRun;
  }

  /** GoToRecord (Task 8 moves it to the form's instance): saved first, the record reached, then its On Current done (R6: nested). */
  async goToRecord(r: RecordTarget, offset = 1): Promise<void> {
    const records = this.records;
    const s = records?.snapshot;
    if (!records || !s) throw new Error('bc:cantGoToRecord');
    const i = r === 'first' ? 0 : r === 'last' ? s.total - 1 : r === 'next' ? s.index + offset : r === 'previous' ? s.index - offset : offset - 1;
    if (!(await (r === 'new' ? records.newRecord() : records.goTo(i)))) throw new Error('bc:cantGoToRecord');
    await this.currentRun;
  }

  /** [Name] (and [Forms]![F]![Name], R11): a control's value, else a field of the current record (with what is being typed);
   *  else ExprRuntimeError unknownField. A calculated control: its last result. */
  value(n: string): Value {
    const s = this.records?.snapshot;
    const info = s?.info ?? NO_INFO;
    const stored = this.view?.stored() ?? Object.fromEntries(info.fields.map((f, i) => [f.name, s?.values[i] ?? null]));
    const fields = fieldValues(info, stored, s?.pending ?? {}, this.base.locale);
    const calc: Record<string, CalcValue> = Object.fromEntries(Object.entries(this.view?.results() ?? {}).map(([k, r]) => [k, r.ok ? r.value : FAILED]));
    return envValue({ fields, controls: controlValues(this.all, info, fields, { ...this.view?.extra(), ...calc }) }, n);
  }
}
