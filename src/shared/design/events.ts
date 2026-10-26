// Closed event list of stage B2 (spec 4.8, rulings R1-R3, R10) and how an event property is read. Pure module.
// An event property holds a macro name (`M` or `M.Sub`), an embedded macro (`{ embedded: MacroDef }`) or, from an import or a
// later version, any other text that is kept and shown as is and does nothing (stage D). Names are invariant: stored as written.
import { isValidObjectName, sameName } from '../field-types';
import { validateMacro, type MacroDef } from '../macro/model';
import type { SectionDef, SectionKind } from './model';

export type EventName = 'OnOpen' | 'OnLoad' | 'OnCurrent' | 'OnClose' | 'BeforeInsert' | 'AfterInsert' | 'BeforeUpdate' | 'AfterUpdate' | 'OnDelete'
  | 'OnClick' | 'OnDblClick' | 'OnEnter' | 'OnExit' | 'OnGotFocus' | 'OnLostFocus' | 'OnChange' | 'OnNoData' | 'OnFormat' | 'OnPrint';

/** The closed list, in catalogue order. */
export const EVENTS: readonly EventName[] = ['OnOpen', 'OnLoad', 'OnCurrent', 'OnClose', 'BeforeInsert', 'AfterInsert', 'BeforeUpdate', 'AfterUpdate',
  'OnDelete', 'OnClick', 'OnDblClick', 'OnEnter', 'OnExit', 'OnGotFocus', 'OnLostFocus', 'OnChange', 'OnNoData', 'OnFormat', 'OnPrint'];

/** Events whose macro can cancel what they guard (R3: OnDblClick cannot, a BaseCraft control has no default double-click action). */
export const CANCELLABLE: ReadonlySet<EventName> = new Set<EventName>(['OnOpen', 'BeforeInsert', 'BeforeUpdate', 'OnDelete', 'OnExit', 'OnNoData', 'OnFormat', 'OnPrint']);

export interface EmbeddedEvent { embedded: MacroDef }
export type EventBinding = { kind: 'none' } | { kind: 'macro'; name: string } | { kind: 'embedded'; def: MacroDef } | { kind: 'other'; text: string };

/** `M` or `M.Sub`, each part a valid object name (a name has no dot, so the split is unambiguous). A leading `=` is a function call (Access): not a name. */
const isMacroRef = (s: string): boolean => { const parts = s.split('.'); return !s.startsWith('=') && parts.length <= 2 && parts.every(isValidObjectName); };
const isEmbedded = (v: unknown): v is EmbeddedEvent =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'embedded' in v && validateMacro(v.embedded).length === 0;

/** The binding an event property stands for (R1). The file is untrusted: any value is read without failing. */
export function readEvent(v: unknown): EventBinding {
  if (v === undefined || v === null || v === '') return { kind: 'none' };
  if (typeof v === 'string') return isMacroRef(v) ? { kind: 'macro', name: v } : { kind: 'other', text: v };
  return isEmbedded(v) ? { kind: 'embedded', def: v.embedded } : { kind: 'other', text: '' };
}

/** What a value typed or built in the Property Sheet must satisfy ('' and undefined clear the event). Imported values are not checked. */
export function checkEventValue(v: unknown): 'badMacroName' | 'badEmbedded' | null {
  if (v === undefined || v === '') return null;
  if (typeof v === 'string') return isMacroRef(v) ? null : 'badMacroName';
  return isEmbedded(v) ? null : 'badEmbedded';
}

/** R10: Access's English section names, invariant in both languages; `n` is the group level, from 0. */
export function sectionName(kind: SectionKind, groupLevel = 0): string {
  switch (kind) {
    case 'pageHeader': return 'PageHeaderSection';
    case 'pageFooter': return 'PageFooterSection';
    case 'groupHeader': return `GroupHeader${groupLevel}`;
    case 'groupFooter': return `GroupFooter${groupLevel}`;
    default: return kind[0]!.toUpperCase() + kind.slice(1);   // formHeader -> FormHeader, detail -> Detail, reportFooter -> ReportFooter
  }
}

/** The index of the section called `name` (case-insensitive), -1 when there is none. */
export const sectionByName = (sections: readonly SectionDef[], name: string): number =>
  sections.findIndex((s) => sameName(sectionName(s.kind, s.groupLevel), name));
