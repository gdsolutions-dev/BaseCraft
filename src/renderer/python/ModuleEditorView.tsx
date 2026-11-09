// Module editor (D1): CodeMirror over the Python source. Save asks the engine for the module's exports (parsing only), stores
// { source, exports }, then resets the user modules. A syntax error still saves (no exports); a bar and a red line show it.
import { closeCompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { indentUnit } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { basicSetup, EditorView } from 'codemirror';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isModuleName, parseModuleDef } from '../../shared/python/module-def';
import { flattenControls } from '../../shared/design/model';
import { api } from '../bridge';
import { parseFormDoc } from '../form/form-def';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal } from '../shell/Modal';
import { registerCommands, registerModeGuard } from '../shell/ribbon-model';
import { basecraftCompletions, type CompletionCatalog } from './completions';
import { functionClashes } from './function-index';
import { pythonHost } from './python-host';
import './module-editor.css';

type SyntaxError = { line: number; col: number; message: string; text?: string };   // text: a runtime error, already worded (R10)
const setErrorLine = StateEffect.define<number | null>();
/** The red line marker. */
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setErrorLine)) {
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      const from = tr.state.doc.line(e.value).from;
      const b = new RangeSetBuilder<Decoration>();
      b.add(from, from, Decoration.line({ class: 'cm-bc-error-line' }));
      return b.finish();
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** R7: object names read once at mount; a form's control names the first time the form is dotted into (cached). */
function completionSource() {
  const cat: CompletionCatalog = { forms: [], reports: [], tables: [], queries: [], macros: [], controls: () => [], fields: () => [] };
  const controls = new Map<string, string[]>();
  cat.controls = (f) => controls.get(f.toLowerCase()) ?? [];
  const names = (k: 'form' | 'report' | 'query' | 'macro') => api.objects.list(k).then((l) => l.map((o) => o.name));
  const ready = Promise.all([names('form'), names('report'), names('query'), names('macro'), api.tables.list()]).then(([forms, reports, queries, macros, tables]) => {
    Object.assign(cat, { forms, reports, queries, macros, tables: tables.map((x) => x.name) });
  }).catch(() => {});
  return async (ctx: CompletionContext) => {
    const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
    const m = before.match(/\bforms(?:\[["']([^"']+)["']\]|\.([A-Za-z_]\w*))\.\w*$/);
    await ready;
    const form = m && cat.forms.find((f) => f.toLowerCase() === (m[1] ?? m[2]).toLowerCase());
    if (form && !controls.has(form.toLowerCase())) {
      try { controls.set(form.toLowerCase(), flattenControls(parseFormDoc((await api.objects.get('form', form)).definition).doc.sections.flatMap((x) => x.controls)).map((c) => c.name)); } catch { controls.set(form.toLowerCase(), []); }
    }
    const r = basecraftCompletions(before, cat);
    return r && { from: line.from + r.from, options: r.options, validFor: /^\w*$/ };
  };
}

/** Loads the definition (a new module starts empty), then the editor. */
export function ModuleEditorView(p: DocViewProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | { error: string } | null>(p.tab.isNew ? '' : null);
  useEffect(() => {
    if (p.tab.isNew) return;
    let current = true;
    api.objects.get('module', p.tab.name).then((r) => { if (current) setSource(parseModuleDef(r.definition).source); }).catch((e) => {
      if (!current) return;
      const m = errorMessage(e);
      setSource({ error: e instanceof Error && e.message === 'bc:badModule' ? t('dialog.error.corruptObject') : t(m.key, m.params) });
    });
    return () => { current = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read once: a save renames the tab, it does not reload
  if (typeof source === 'object' && source) return <div className="doc-empty muted" role="alert" data-testid="module-load-error">{source.error}</div>;
  return source === null ? <div className="module-editor" /> : <ModuleEditor {...p} initial={source} />;
}

function ModuleEditor({ tab, readOnly, dispatch, initial }: DocViewProps & { initial: string }) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const dirty = useRef(false);
  const busy = useRef<Promise<unknown> | null>(null);   // the save under way
  const [error, setError] = useState<SyntaxError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);   // R12: after a save, exports named like another module's or a built-in's
  const live = useRef({ tab, readOnly });
  live.current = { tab, readOnly };

  const markDirty = (v: boolean) => { dirty.current = v; void dispatch({ type: 'setDirty', id: live.current.tab.id, dirty: v }); };

  useEffect(() => {
    const py = python();
    const ev = new EditorView({
      doc: initial, parent: host.current!,
      extensions: [basicSetup, py, py.language.data.of({ autocomplete: completionSource() }), indentUnit.of('    '), errorLine, EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => { if (u.docChanged) markDirty(true); }),
        // CodeMirror closes the list on blur only once it is shown: a list still being computed (the catalog is read from the base)
        // opened afterwards, over a dialog (the save's name), and took its clicks. Out of focus, no list.
        EditorView.updateListener.of((u) => { if (!u.view.hasFocus && completionStatus(u.state) !== null) setTimeout(() => closeCompletion(u.view)); })],
    });
    view.current = ev;
    return () => { ev.destroy(); void dispatch({ type: 'setDirty', id: live.current.tab.id, dirty: false }); };
  }, [tab.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- one editor per tab

  // R10: « Débogage » opens the module with a line (and the error text): cursor there, scrolled into view, red marker and bar
  useEffect(() => {
    const line = tab.openArgs?.line, ev = view.current;
    if (!ev || !line || line < 1 || line > ev.state.doc.lines) return;
    const pos = ev.state.doc.line(line).from;
    ev.dispatch({ selection: { anchor: pos }, effects: [EditorView.scrollIntoView(pos, { y: 'center' }), setErrorLine.of(line)] });
    ev.focus();
    setError(tab.openArgs?.message ? { line, col: 0, message: '', text: tab.openArgs.message } : null);
  }, [tab.openArgs]);

  const message = (messageKey: string) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, buttons: ['ok'] });
  const askName = (initialName: string) => modal.prompt({ titleKey: 'designer.saveAsTitle', labelKey: 'module.nameLabel', initial: initialName,
    validate: (v) => (isModuleName(v) ? null : t('module.badName')) });

  /** The name saved under, or null (nothing saved). */
  const saveNow = async (): Promise<string | null> => {
    if (live.current.readOnly) { await message('dialog.op.readOnly'); return null; }
    try {
      const doc = live.current.tab;
      const source = view.current!.state.doc.toString();
      let name = doc.isNew ? await askName(doc.name) : doc.name;
      if (name === null) return null;
      // The first call starts Python. If the engine fails, the code is saved anyway (exports are recomputed at the next save).
      let parsed: Awaited<ReturnType<ReturnType<typeof pythonHost>['exports']>> = { exports: [], error: null };
      let engineDown = false;
      try { parsed = await pythonHost().exports(source); } catch { engineDown = true; }
      for (;;) {
        const r = await api.objects.save('module', name, { formatVersion: '1.0', source, exports: parsed.exports }, doc.isNew ? null : doc.name);
        if (r.ok) {
          if (!engineDown && pythonHost().state() !== 'off') await pythonHost().reset();   // R7: a saved module resets every user module
          setError(parsed.error);
          functionClashes(name, parsed.exports).then((c) => setWarnings(c.map((x) => (x.other === null ? t('module.functionBuiltin', { name: x.fn }) : t('module.functionClash', { name: x.fn, fn: x.fn, other: x.other })))),
            () => setWarnings([]));
          view.current!.dispatch({ effects: setErrorLine.of(parsed.error?.line ?? null) });
          if (view.current!.state.doc.toString() === source) markDirty(false);   // typed during the awaits: stay dirty
          dispatch(doc.isNew ? { type: 'objectSaved', kind: 'module', name, tabId: doc.id } : { type: 'objectSaved', kind: 'module', name });
          if (engineDown) await message('module.exportsUnavailable');
          return name;
        }
        await message(r.reason === 'badModuleName' ? 'module.badName' : `dialog.op.${r.reason}`);
        if (!doc.isNew || (r.reason !== 'nameExists' && r.reason !== 'nameInvalid' && r.reason !== 'badModuleName')) return null;
        name = await askName(name);
        if (name === null) return null;
      }
    } catch (e) {
      await showError(e);
      return null;
    }
  };
  /** One save at a time; leaving waits for the one under way (Access's save is over before the next action). */
  const save = (): Promise<string | null> => busy.current ? Promise.resolve(null) : (busy.current = saveNow().finally(() => { busy.current = null; }));

  /** Before the view goes: Yes saves, No drops the changes, Cancel keeps the module open. */
  const leave = async (): Promise<boolean> => {
    while (busy.current) await busy.current;   // closed or switched while Ctrl+S is saving: once saved (Access)
    if (!dirty.current) return true;
    const r = await modal.confirm({ titleKey: 'module.saveFirstTitle', messageKey: 'module.saveFirst', params: { name: live.current.tab.name }, buttons: ['yes', 'no', 'cancel'] });
    return r === 'no' || (r === 'yes' && (await save()) !== null);
  };

  const cmds = useRef({ save, leave });
  cmds.current = { save, leave };
  useEffect(() => {
    const off = registerCommands(tab.id, { save: async () => { await cmds.current.save(); } });
    const offGuard = registerModeGuard(tab.id, () => cmds.current.leave());
    return () => { off(); offGuard(); };
  }, [tab.id]);

  return (
    <div className="module-editor-wrap">
      <div className="module-editor" ref={host} data-testid="module-editor" />
      {warnings.length > 0 && <div className="module-error" role="status" data-testid="module-warning">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      {error && <div className="module-error" role="alert" data-testid="module-error">{error.text ?? t('module.syntaxError', { line: error.line, message: error.message })}</div>}
    </div>
  );
}
