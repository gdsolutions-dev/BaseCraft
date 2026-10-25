// Macro interpreter, with Access's semantics: blocks, OnError, TempVars / LocalVars / MacroError, RunMacro, single step.
// Pure and asynchronous: every action the engine does not handle itself goes to the host (the shell).
import { ExprRuntimeError, ExprSyntaxError, type Expr, type Value } from '../../shared/expr/ast';
import { evaluate, truthy, type EvalEnv } from '../../shared/expr/evaluate';
import { fail, infoOf, num, str, toText } from '../../shared/expr/library';
import { bindMembers } from '../../shared/expr/members';
import { parseCanonical, serialize } from '../../shared/expr/parser';
import { foldName, sameName } from '../../shared/field-types';
import { actionDef, type ActionDef, type ActionName } from '../../shared/macro/catalog';
import { validateMacro, type MacroDef, type MacroItem } from '../../shared/macro/model';

/** enum / name / text / sql / where → string (where: canonical, members bound); expression → Value; number → string. */
export type ResolvedArgs = Record<string, string | Value>;
export interface ActionCall { macro: string; action: ActionName; args: ResolvedArgs; raw: Record<string, string> }
export interface MacroHost {
  load(name: string): Promise<MacroDef>;            // rejects bc:notFound for an unknown macro
  contentEnabled(): boolean;
  perform(call: ActionCall): Promise<void | 'stopAll'>;   // the shell's actions; a throw is the action's failure; 'stopAll' ends the run (Quit, CloseDatabase)
  tempVars: Map<string, Value>;                     // keyed by foldName(name); shared by every run of this base
  step?(s: StepInfo): Promise<'step' | 'continue' | 'stopAll'>;
  locale: string; lang: 'fr' | 'en'; now(): Date;
}
export interface StepInfo { macro: string; condition: string | null; action: string; args: Record<string, string> }
export type FailureCode = 'unknownAction' | 'notFound' | 'blocked' | 'actionFailed' | 'expression' | 'missingArgument' | 'tooDeep' | 'tooManySteps' | 'badDefinition';
export interface MacroFailure { macro: string; action: string; raw: Record<string, string>; code: FailureCode; number: number; detail?: string; cause?: unknown }
export type RunOutcome = { ok: true } | { ok: false; failure: MacroFailure };

export const FAILURE_NUMBERS: Record<FailureCode, number> = {
  unknownAction: 2001, notFound: 2002, blocked: 2003, actionFailed: 2004, expression: 2005,
  missingArgument: 2006, tooDeep: 2007, tooManySteps: 2008, badDefinition: 2009,
};
export const MAX_RUN_DEPTH = 20;
export const MAX_STEPS = 100_000;
export const MAX_TEMP_VARS = 255;

/** A failure of the current action. */
class Fail { constructor(public code: FailureCode, public detail?: string, public cause?: unknown) {} }
/** Ends the whole run: StopAllMacros / step 'stopAll' (no failure), or a failure no OnError handles. */
class Halt { constructor(public failure?: MacroFailure) {} }
/** A failure the macro does not handle: it ends the macro (and becomes the failure of the caller's RunMacro). */
class Unhandled { constructor(public failure: MacroFailure) {} }
const FATAL = new Set<FailureCode>(['blocked', 'tooManySteps']);

interface Run { host: MacroHost; steps: number; stepping: boolean; error: MacroFailure | null }
interface Loaded { name: string; def: MacroDef; items: MacroItem[] }
interface Frame { name: string; def: MacroDef; locals: Map<string, Value>; onError: { goTo: string; macroName: string }; depth: number }

const isBlank = (s: string | undefined): boolean => s === undefined || s.trim() === '';
const macrotask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Runs `M` (its items up to the first submacro) or `M.Sub`. */
export async function runMacro(name: string, host: MacroHost, opts: { singleStep?: boolean } = {}): Promise<RunOutcome> {
  const run: Run = { host, steps: 0, stepping: opts.singleStep === true, error: null };
  let loaded: Loaded;
  try { loaded = await load(host, name); } catch (e) {
    return { ok: false, failure: failureOf({ name }, '', {}, e) };
  }
  try {
    const failure = await callMacro(run, loaded, 1);
    return failure ? { ok: false, failure } : { ok: true };
  } catch (e) {
    if (e instanceof Halt) return e.failure ? { ok: false, failure: e.failure } : { ok: true };
    throw e;
  }
}

async function load(host: MacroHost, name: string): Promise<Loaded> {
  const dot = name.indexOf('.'), base = dot < 0 ? name : name.slice(0, dot);
  let def: MacroDef;
  try { def = await host.load(base); } catch (e) {
    const message = e instanceof Error ? e.message : '';
    throw new Fail(message === 'bc:notFound' ? 'notFound' : message === 'bc:invalidDefinition' ? 'badDefinition' : 'actionFailed', message, e);
  }
  const issue = validateMacro(def)[0];
  if (issue) throw new Fail('badDefinition', `${issue.path}: ${issue.code}`);
  if (dot < 0) return { name, def, items: def.items };
  const sub = submacro(def, name.slice(dot + 1));
  if (!sub) throw new Fail('notFound', name);
  return { name, def, items: sub.items };
}

const submacro = (def: MacroDef, name: string): Extract<MacroItem, { k: 'submacro' }> | undefined =>
  def.items.find((i): i is Extract<MacroItem, { k: 'submacro' }> => i.k === 'submacro' && sameName(i.name, name));

/** A run of a macro (a RunMacro starts in `fail` mode with its own LocalVars): its unhandled failure, or null. */
async function callMacro(run: Run, m: Loaded, depth: number): Promise<MacroFailure | null> {
  const frame: Frame = { name: m.name, def: m.def, locals: new Map(), onError: { goTo: 'fail', macroName: '' }, depth };
  try { await runItems(run, frame, m.items, null); return null; } catch (e) {
    if (e instanceof Unhandled) return e.failure;
    throw e;
  }
}

/** Runs a list of items; true when the macro has ended (StopMacro, or after an OnError submacro). */
async function runItems(run: Run, frame: Frame, items: MacroItem[], condition: string | null): Promise<boolean> {
  for (const item of items) {
    switch (item.k) {
      case 'comment': break;
      case 'submacro': return false;   // `M` stops at its first submacro
      case 'group': if (await runItems(run, frame, item.items, condition)) return true; break;
      case 'if': {
        let chosen: { cond: string | null; items: MacroItem[] } = { cond: null, items: item.else ?? [] };
        try {
          for (const b of item.branches) {
            if (truthy(await evaluate(parseCanonical(b.cond), env(run, frame)), infoOf(run.host.locale)) === true) { chosen = b; break; }
          }
        } catch (e) {
          if (await handle(run, frame, failureOf(frame, 'If', {}, e))) return true;
          break;
        }
        if (await runItems(run, frame, chosen.items, chosen.cond)) return true;
        break;
      }
      case 'action': if (await runAction(run, frame, item, condition)) return true; break;
    }
  }
  return false;
}

async function runAction(run: Run, frame: Frame, item: Extract<MacroItem, { k: 'action' }>, condition: string | null): Promise<boolean> {
  const { host } = run;
  try {
    await count(run);
    if (run.stepping && host.step) {
      const answer = await host.step({ macro: frame.name, condition, action: item.action, args: item.args });
      if (answer === 'stopAll') throw new Halt();
      if (answer === 'continue') run.stepping = false;
    }
    const def = actionDef(item.action);
    if (!def) throw new Fail('unknownAction');
    if (def.unsafe && !host.contentEnabled()) throw new Fail('blocked');
    const args = await resolveArgs(run, frame, def, item.args);
    return await execute(run, frame, def.name, args, item.args);
  } catch (e) {
    if (e instanceof Halt) throw e;
    const failure = e instanceof Unhandled ? e.failure : failureOf(frame, item.action, item.args, e);
    if (!(e instanceof Unhandled) && FATAL.has(failure.code)) throw new Halt(failure);
    return handle(run, frame, failure);
  }
}

/** One more step of the run: past MAX_STEPS the run stops; every 100 steps the window gets a turn. */
async function count(run: Run): Promise<void> {
  if (++run.steps > MAX_STEPS) throw new Fail('tooManySteps');
  if (run.steps % 100 === 0) await macrotask();
}

/** Applies the macro's OnError mode to a failure; true when the macro has ended. */
async function handle(run: Run, frame: Frame, failure: MacroFailure): Promise<boolean> {
  run.error = failure;
  if (frame.onError.goTo === 'next') return false;
  const sub = frame.onError.goTo === 'macroName' ? submacro(frame.def, frame.onError.macroName) : undefined;
  if (!sub) throw new Unhandled(failure);
  // The handler starts in `fail` mode: a failure inside it ends the macro instead of jumping back to it forever.
  const base = frame.name.split('.')[0]!;
  await runItems(run, { ...frame, name: `${base}.${sub.name}`, onError: { goTo: 'fail', macroName: '' } }, sub.items, null);
  return true;
}

function failureOf(frame: { name: string }, action: string, raw: Record<string, string>, e: unknown): MacroFailure {
  const [code, detail, cause]: [FailureCode, string | undefined, unknown] = e instanceof Fail ? [e.code, e.detail, e.cause]
    : e instanceof ExprSyntaxError || e instanceof ExprRuntimeError ? ['expression', e.code, e]
    : e instanceof Error && e.message === 'bc:contentDisabled' ? ['blocked', undefined, e]   // the host found the content disabled (an action query)
    : ['actionFailed', e instanceof Error ? e.message : String(e), e];
  return { macro: frame.name, action, raw, code, number: FAILURE_NUMBERS[code], detail, cause };
}

function env(run: Run, frame: Frame): EvalEnv {
  const { host } = run;
  return { field: () => fail('unknownField'), now: () => host.now(), locale: host.locale, lang: host.lang, member: (path) => member(run, frame, path) };
}

function member(run: Run, frame: Frame, [root, key = '']: string[]): Value {
  switch (root) {
    case 'TempVars': return run.host.tempVars.get(foldName(key)) ?? null;
    case 'LocalVars': return frame.locals.get(foldName(key)) ?? null;
    case 'MacroError': {
      const e = run.error;
      if (sameName(key, 'Number')) return num(e?.number ?? 0);
      if (sameName(key, 'Description')) return str(e ? e.detail ?? e.code : '');
      if (sameName(key, 'ActionName')) return str(e?.action ?? '');
      if (sameName(key, 'MacroName')) return str(e?.macro ?? '');
      return fail('unknownField');
    }
    default: return fail('unknownField');   // Forms / Reports: B2
  }
}

const evalText = async (run: Run, frame: Frame, text: string): Promise<Value> => evaluate(parseCanonical(text), env(run, frame));

async function resolveArgs(run: Run, frame: Frame, def: ActionDef, raw: Record<string, string>): Promise<ResolvedArgs> {
  const args: ResolvedArgs = {};
  for (const a of def.args) {
    const value = raw[a.name];
    if (isBlank(value)) {
      if (a.required) throw new Fail('missingArgument', a.name);
      if (a.default !== undefined) args[a.name] = a.default;
      continue;
    }
    const text = value!;
    switch (a.type) {
      case 'expression': args[a.name] = await evalText(run, frame, text); break;
      case 'where': args[a.name] = serialize(await bindMembers(parseCanonical(text), async (p) => member(run, frame, p))); break;
      case 'text': case 'number': {
        if (!text.startsWith('=')) { args[a.name] = text; break; }
        const v = await evalText(run, frame, text.slice(1));
        args[a.name] = v === null ? '' : toText(v, infoOf(run.host.locale));
        break;
      }
      default: args[a.name] = text;
    }
  }
  return args;
}

const nameArg = (args: ResolvedArgs, name: string): string => {
  const v = args[name];
  if (typeof v !== 'string' || v.trim() === '') throw new Fail('missingArgument', name);
  return v;
};

/** Runs one action; true when the macro has ended. */
async function execute(run: Run, frame: Frame, action: ActionName, args: ResolvedArgs, raw: Record<string, string>): Promise<boolean> {
  const { host } = run;
  switch (action) {
    case 'StopMacro': return true;
    case 'StopAllMacros': throw new Halt();
    case 'RunMacro': {
      if (frame.depth >= MAX_RUN_DEPTH) throw new Fail('tooDeep');
      const countText = args.RepeatCount as string | undefined;   // a non-negative whole number in decimal digits (not 1.5, not 0x10)
      if (countText !== undefined && !/^\s*\d+\s*$/.test(countText)) throw new Fail('actionFailed', 'RepeatCount');
      const times = countText === undefined ? undefined : Number(countText);
      const repeat: Expr | undefined = isBlank(raw.RepeatExpression) ? undefined : parseCanonical(raw.RepeatExpression!);
      const target = await load(host, nameArg(args, 'MacroName'));
      const once = times === undefined && !repeat;
      for (let i = 0; once ? i < 1 : times === undefined || i < times; i++) {
        if (i > 0) await count(run);   // each repeat is a step: an empty macro repeated forever still stops
        if (repeat && truthy(await evaluate(repeat, env(run, frame)), infoOf(host.locale)) !== true) break;
        const failure = await callMacro(run, target, frame.depth + 1);
        if (failure) throw new Unhandled(failure);
      }
      return false;
    }
    case 'SetTempVar': {
      const key = foldName(nameArg(args, 'Name'));
      if (!host.tempVars.has(key) && host.tempVars.size >= MAX_TEMP_VARS) throw new Fail('actionFailed', 'tooManyTempVars');
      host.tempVars.set(key, args.Expression as Value);
      return false;
    }
    case 'RemoveTempVar': host.tempVars.delete(foldName(nameArg(args, 'Name'))); return false;
    case 'RemoveAllTempVars': host.tempVars.clear(); return false;
    case 'SetLocalVar': frame.locals.set(foldName(nameArg(args, 'Name')), args.Expression as Value); return false;
    case 'OnError': {
      const goTo = args.GoTo as string;
      frame.onError = { goTo, macroName: goTo === 'macroName' ? nameArg(args, 'MacroName') : '' };
      return false;
    }
    case 'ClearMacroError': run.error = null; return false;
    default: if (await host.perform({ macro: frame.name, action, args, raw }) === 'stopAll') throw new Halt(); return false;
  }
}
