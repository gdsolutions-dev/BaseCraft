// Keyboard shortcut keys in captions (Access): « &Nom » underlines N, and Alt+N goes to the control (a button is clicked, a control
// whose label it is gets the focus); « && » is a literal ampersand. Pure: the Design and Form views draw and answer them, and the error
// checking reports the keys that are invalid or used twice.
import type { ControlDef, DesignDoc } from './model';

export interface CaptionParts { before: string; key: string; after: string }
const KEYABLE = /^[\p{L}\p{N}]$/u;
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');

/** The caption split around its shortcut key (the first single `&`); `key` is '' without one or when it is no letter or digit. */
export function captionParts(caption: string): CaptionParts {
  let before = '';
  for (let i = 0; i < caption.length; i++) {
    if (caption[i] !== '&') { before += caption[i]; continue; }
    const next = caption[i + 1];
    if (next === '&') { before += '&'; i++; continue; }
    if (next === undefined) break;
    const rest = caption.slice(i + 2).replace(/&&/g, '&');
    return KEYABLE.test(next) ? { before, key: next, after: rest } : { before, key: '', after: next + rest };
  }
  return { before, key: '', after: '' };
}
/** The caption as displayed (without its markers). */
export const plainCaption = (caption: string): string => { const p = captionParts(caption); return p.before + p.key + p.after; };
/** Does the caption have a single `&` followed by something that cannot be a shortcut key (a space, a sign)? */
export const hasInvalidKey = (caption: string): boolean => /(^|[^&])(&&)*&[^\p{L}\p{N}&]/u.test(caption);

const CAPTIONED = new Set<ControlDef['kind']>(['label', 'commandButton', 'toggleButton']);
export interface ShortcutTarget { key: string; control: string; /** the control Alt+key acts on: itself (a button) or the control the label belongs to */ target: string; button: boolean }

/** Every shortcut key of the document, in reading order: the control that carries it and the one it acts on (a free label acts on nothing). */
export function shortcutKeys(doc: DesignDoc): ShortcutTarget[] {
  const out: ShortcutTarget[] = [];
  const walk = (cs: ControlDef[], parent?: ControlDef) => {
    for (const c of cs) {
      const caption = c.props.Caption;
      if (CAPTIONED.has(c.kind) && typeof caption === 'string') {
        const { key } = captionParts(caption);
        if (key) out.push({ key: fold(key), control: c.name, target: c.kind === 'label' ? parent?.name ?? '' : c.name, button: c.kind !== 'label' });
      }
      if (c.children) walk(c.children, c);
    }
  };
  for (const s of doc.sections) walk(s.controls);
  return out;
}

/** The target of Alt+`key` (a single character): the first control that has it, or undefined. */
export const shortcutFor = (doc: DesignDoc, key: string): ShortcutTarget | undefined => shortcutKeys(doc).find((k) => k.key === fold(key) && k.target !== '');

export interface ShortcutIssue { code: 'shortcutInvalid' | 'shortcutDuplicate'; control: string; detail: string }
/** Keyboard shortcut errors: a caption whose `&` is followed by no letter or digit, a key already used by an earlier control. */
export function shortcutIssues(doc: DesignDoc): ShortcutIssue[] {
  const out: ShortcutIssue[] = [];
  const seen = new Set<string>();
  const walk = (cs: ControlDef[]) => {
    for (const c of cs) {
      const caption = c.props.Caption;
      if (CAPTIONED.has(c.kind) && typeof caption === 'string') {
        if (hasInvalidKey(caption)) out.push({ code: 'shortcutInvalid', control: c.name, detail: '' });
        const { key } = captionParts(caption);
        if (key) { const k = fold(key); if (seen.has(k)) out.push({ code: 'shortcutDuplicate', control: c.name, detail: key.toLocaleUpperCase() }); seen.add(k); }
      }
      if (c.children) walk(c.children);
    }
  };
  for (const s of doc.sections) walk(s.controls);
  return out;
}
