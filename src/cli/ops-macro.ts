import { findPythonFunction } from './ops-module';
import type { DatabaseSync } from 'node:sqlite';
import { sameName } from '../shared/field-types';
import { EVENTS, checkEventValue, readEvent } from '../shared/design/events';
import { flattenControls, type DesignDoc } from '../shared/design/model';
import { PROPERTY_CATALOG, type PropertyTarget } from '../shared/design/properties';
import { actionDef } from '../shared/macro/catalog';
import { parseMacroDef, submacroNames, validateMacro } from '../shared/macro/model';
import { getObject, saveObject, setObjectDescription } from '../main/db/objects';
import type { OpOutcome } from './ops';

const refuse = (message: string): OpOutcome => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Paths of the actions outside the closed catalogue (validateMacro tolerates them: a newer BaseCraft may write them; the CLI does not). */
function unknownActions(items: unknown[], path: string, out: string[]): void {
  items.forEach((it, i) => {
    if (!isObject(it)) return;
    const p = `${path}[${i}]`;
    if (it.k === 'action' && typeof it.action === 'string' && !actionDef(it.action)) out.push(`${p}.action: unknownAction`);
    if (Array.isArray(it.items)) unknownActions(it.items, `${p}.items`, out);
    if (Array.isArray(it.else)) unknownActions(it.else, `${p}.else`, out);
    if (Array.isArray(it.branches)) it.branches.forEach((b, j) => { if (isObject(b) && Array.isArray(b.items)) unknownActions(b.items, `${p}.branches[${j}].items`, out); });
  });
}

/** The refusals for a macro definition, each prefixed with `prefix`; [] when valid. */
function macroProblems(def: unknown, prefix = ''): string[] {
  const issues = validateMacro(def);
  if (issues.length) return issues.map((i) => `${prefix}${i.path}: ${i.code}`);
  const out: string[] = [];
  unknownActions((def as { items: unknown[] }).items, `${prefix}items`, out);
  return out;
}

function macroCreate(db: DatabaseSync, args: Record<string, unknown>): OpOutcome {
  const { name: rawName, items, description } = args;
  if (typeof rawName !== 'string') return refuse('"name" must be a string');
  if (description !== undefined && typeof description !== 'string') return refuse('"description" must be a string');
  if (!Array.isArray(items)) return refuse('"items" must be an array');
  const name = rawName.normalize('NFC');
  const def = { formatVersion: '1.0', items };
  const problems = macroProblems(def);
  if (problems.length) return refuse(problems.join('; '));
  const r = saveObject(db, 'macro', name, def, null);
  if (!r.ok) return refuse(r.reason === 'nameExists' ? `macro name already used: ${name}` : r.reason === 'nameInvalid' ? `invalid macro name: ${name}` : r.reason);
  if (description !== undefined) setObjectDescription(db, 'macro', name, description);
  return { ok: true };
}

const KNOWN_PROPS = new Set(PROPERTY_CATALOG.map((d) => d.name));
const EVENT_LIKE = /^(On|Before|After)[A-Z]/;
const EVENT_DESCRIPTORS = PROPERTY_CATALOG.filter((d) => d.tab === 'event');

/** Refusals for the event properties of a props bag on `target` (a form, report, section kind or control kind) of an object of `kind`. */
function checkProps(db: DatabaseSync, kind: 'form' | 'report', target: PropertyTarget, props: Record<string, unknown>, path: string): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const at = `${path}.${key}`;
    const d = EVENT_DESCRIPTORS.find((x) => x.name === key && (EVENTS as readonly string[]).includes(key));
    if (!d) { if (EVENT_LIKE.test(key) && !KNOWN_PROPS.has(key)) out.push(`${at}: unknown event ${key}`); continue; }
    if (!d.appliesTo.includes(target) || (d.objects && !d.objects.includes(kind))) { out.push(`${at}: ${key} does not apply to a ${target} of a ${kind}`); continue; }
    const b = readEvent(value);
    if (b.kind === 'none') continue;
    if (b.kind === 'python') { const f = findPythonFunction(db, b.name); if (!f.ok) out.push(`${at}: ${f.message}`); continue; }
    // readEvent reads an invalid embedded macro as 'other': give the validator's paths instead of a bare badEmbedded
    if (b.kind === 'other' && value !== null && typeof value === 'object' && 'embedded' in value) { out.push(...macroProblems((value as { embedded: unknown }).embedded, `${at}.embedded.`)); continue; }
    if (b.kind === 'other') { out.push(`${at}: ${checkEventValue(value) ?? 'badMacroName'}`); continue; }
    if (b.kind === 'embedded') { out.push(...macroProblems(b.def, `${at}.embedded.`)); continue; }
    const [first, sub] = b.name.split('.');
    const m = getObject(db, 'macro', first);
    if (!m) { out.push(`${at}: macro not found: ${first}`); continue; }
    if (sub !== undefined && !submacroNames(parseMacroDef(m.definition)).some((n) => sameName(n, sub))) out.push(`${at}: submacro not found: ${b.name}`);
  }
  return out;
}

/** Refusals for every event property of a design document (form or report), [] when valid. A macro, or the module of a Python function, must already exist: create it earlier in the script. */
export function checkEventBindings(db: DatabaseSync, kind: 'form' | 'report', doc: DesignDoc): string[] {
  const out = checkProps(db, kind, kind, doc.props, 'design.props');
  doc.sections.forEach((s, i) => {
    out.push(...checkProps(db, kind, s.kind, s.props, `design.sections[${i}].props`));
    for (const c of flattenControls(s.controls)) out.push(...checkProps(db, kind, c.kind, c.props, `control ${c.name}`));
  });
  return out;
}

export const MACRO_HANDLERS = { 'macro.create': macroCreate };
