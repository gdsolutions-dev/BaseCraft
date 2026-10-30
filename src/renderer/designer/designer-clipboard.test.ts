import { describe, expect, it } from 'vitest';
import type { ControlDef, ControlKind, DesignDoc } from '../../shared/design/model';
import { setClip } from '../exchange/object-clipboard';
import { canPaste, pasteEnabled, clipboardAction, copySelection, pasteControls, type ClipContext } from './designer-clipboard';
import { designerReducer, findControl, initDesigner, type DesignerState } from './designer-model';
import { gridStep } from './units';

const ctl = (kind: ControlKind, name: string, left: number, top: number, props: Record<string, unknown> = {}, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props, ...(children ? { children } : {}) });
const embedded = { embedded: { formatVersion: '1.0', items: [] } };
// detail : Texte1 (+ étiquette attachée Étiquette1), Bouton1 ; en-tête : Étiquette2
const form = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 10000 }, sections: [
  { kind: 'formHeader', height: 567, props: {}, controls: [ctl('label', 'Étiquette2', 0, 0, { Caption: 'Titre' })] },
  { kind: 'detail', height: 2268, props: {}, controls: [
    ctl('textBox', 'Texte1', 1418, 0, { ControlSource: 'Nom', Format: 'Fixed', TabIndex: 0, OnClick: embedded },
      [ctl('label', 'Étiquette1', 0, 0, { Caption: 'Nom:' })]),
    ctl('commandButton', 'Bouton1', 1418, 1134, { Caption: 'OK', TabIndex: 1 })] },
  { kind: 'formFooter', height: 0, props: {}, controls: [] },
] });
const report = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 5000 }, sections: [
  { kind: 'pageHeader', height: 567, props: {}, controls: [] },
  { kind: 'detail', height: 567, props: {}, controls: [ctl('textBox', 'Texte1', 0, 0)] },
] });
const PREFIX: Record<string, string> = { textBox: 'Texte', label: 'Étiquette', commandButton: 'Commande' };
const FORM_KINDS: ControlKind[] = ['label', 'textBox', 'commandButton', 'checkBox', 'line', 'tabControl'];
const fctx = (): ClipContext => ({ target: 'form', kinds: FORM_KINDS, prefix: (k) => PREFIX[k] ?? k });
const rctx: ClipContext = { target: 'report', kinds: ['label', 'textBox', 'checkBox'], prefix: (k) => PREFIX[k] ?? k };
const sel = (doc: DesignDoc, ...names: string[]): DesignerState =>
  designerReducer(initDesigner(doc, 'form'), { type: 'select', selection: { kind: 'controls', names } });

describe('designer clipboard', () => {
  it('copies the selected controls with every property and their attached label, once each', () => {
    const doc = form();
    const clip = copySelection(doc, { kind: 'controls', names: ['Texte1', 'Étiquette1', 'Bouton1'] })!;
    expect(clip.controls.map((c) => c.name)).toEqual(['Texte1', 'Bouton1']);   // the label comes with its control, not twice
    expect(clip.controls[0]).toEqual(doc.sections[1].controls[0]);
    expect(clip.controls[0]).not.toBe(doc.sections[1].controls[0]);   // a copy: later edits do not reach it
    expect(copySelection(doc, { kind: 'doc' })).toBeNull();
    expect(copySelection(doc, { kind: 'controls', names: [] })).toBeNull();
    // an attached label alone is copied alone
    expect(copySelection(doc, { kind: 'controls', names: ['Étiquette1'] })!.controls.map((c) => c.name)).toEqual(['Étiquette1']);
  });

  it('pastes below the source in its own section, renamed Access style, label still attached, TabIndex next', () => {
    const doc = form();
    const clip = copySelection(doc, { kind: 'controls', names: ['Texte1'] })!;
    const out = pasteControls(doc, clip, 1, fctx())!;
    expect(out).toHaveLength(1);
    const [t] = out;
    expect([t.name, t.children![0].name]).toEqual(['Texte2', 'Étiquette3']);
    expect(t.props).toEqual({ ControlSource: 'Nom', Format: 'Fixed', TabIndex: 2, OnClick: embedded });   // formatting, source, events kept
    expect([t.left, t.top, t.children![0].left, t.children![0].top]).toEqual([1418, 340, 0, 340]);   // just below, same layout
  });

  it('a multi-selection keeps its relative positions and skips past every control it would cover', () => {
    const doc = form();
    const clip = copySelection(doc, { kind: 'controls', names: ['Texte1', 'Bouton1'] })!;
    const out = pasteControls(doc, clip, 1, fctx())!;
    expect(out.map((c) => [c.name, c.left, c.top])).toEqual([['Texte2', 1418, 1474], ['Commande1', 1418, 2608]]);
    expect(out[1].props.TabIndex).toBe(3);
  });

  it('keeps the position where nothing is in the way (cut then paste, another form) and stays inside the width', () => {
    const doc = form();
    const clip = copySelection(doc, { kind: 'controls', names: ['Texte1'] })!;
    const [h] = pasteControls(doc, clip, 0, fctx())!;   // the header has a label at 0,0 only: covered, so below it
    expect([h.left, h.top]).toEqual([1418, 340]);
    const [f] = pasteControls(doc, clip, 2, fctx())!;   // empty footer: in place
    expect([f.left, f.top]).toEqual([1418, 0]);
    const narrow = { ...form(), props: { Width: 3000 } };
    const button = copySelection(doc, { kind: 'controls', names: ['Bouton1'] })!;
    expect(pasteControls(narrow, button, 2, fctx())![0].left).toBe(732);   // right edge 3686 > 3000: moved left
    expect(pasteControls(narrow, clip, 2, fctx())![0].left).toBe(1418);   // its label is already at 0: wider than the form, kept (the form grows)
  });

  it('drops the kinds the target does not have; nothing left: null', () => {
    const doc = form();
    const clip = copySelection(doc, { kind: 'controls', names: ['Texte1', 'Bouton1'] })!;
    const out = pasteControls(report(), clip, 1, rctx)!;
    expect(out.map((c) => c.name)).toEqual(['Texte2']);
    expect(out[0].props.TabIndex).toBe(0);   // a report has no tab order: left as copied
    expect(pasteControls(report(), copySelection(doc, { kind: 'controls', names: ['Bouton1'] })!, 1, rctx)).toBeNull();
  });

  it('copy, cut and paste actions: one insert, one delete, each one undo step', () => {
    const s = sel(form(), 'Texte1');
    expect(clipboardAction('copy', s, fctx())).toBeNull();
    const pasted = designerReducer(s, clipboardAction('paste', s, fctx())!);
    expect(findControl(pasted.doc, 'Texte2')?.section).toBe(1);
    expect(pasted.selection).toEqual({ kind: 'controls', names: ['Texte2'] });
    expect(designerReducer(pasted, { type: 'undo' }).doc).toEqual(s.doc);
    const two = sel(form(), 'Texte1', 'Bouton1');
    clipboardAction('copy', two, fctx());
    expect(designerReducer(two, clipboardAction('paste', two, fctx())!).selection).toEqual({ kind: 'controls', names: ['Texte2', 'Commande1'] });
    const cut = clipboardAction('cut', sel(form(), 'Bouton1'), fctx())!;
    expect(cut).toEqual({ type: 'deleteSelection' });
    // the paste goes to the selected section (here the header's), else to the Detail
    const header = designerReducer(initDesigner(form(), 'form'), { type: 'select', selection: { kind: 'section', index: 0 } });
    expect(clipboardAction('paste', header, fctx())).toMatchObject({ type: 'insert', section: 0, controls: [{ name: 'Commande1' }] });
    expect(clipboardAction('paste', initDesigner(form(), 'form'), fctx())).toMatchObject({ type: 'insert', section: 1 });
    expect(clipboardAction('paste', sel(form(), 'Étiquette2'), fctx())).toMatchObject({ section: 0 });
  });

  it('nothing to copy keeps the clip; nothing pasteable: no action', () => {
    expect(clipboardAction('copy', initDesigner(form(), 'form'), fctx())).toBeNull();
    expect(clipboardAction('cut', initDesigner(form(), 'form'), fctx())).toBeNull();
    clipboardAction('copy', sel(form(), 'Bouton1'), fctx());
    expect(clipboardAction('paste', initDesigner(report(), 'report'), rctx)).toBeNull();
  });

  it('keeps a free name (cut then paste, another object); renames only on a collision', () => {
    const doc: DesignDoc = { ...form(), sections: form().sections.map((x, i) => (i === 1 ? { ...x, controls: [
      ctl('textBox', 'txtTotal', 1418, 0, {}, [ctl('label', 'lblTotal', 0, 0)]), ctl('textBox', 'txtTTC', 1418, 567, { ControlSource: '=[txtTotal]*1.2' })] } : x)) };
    const s = sel(doc, 'txtTotal');
    const cut = designerReducer(s, clipboardAction('cut', s, fctx())!);
    const back = clipboardAction('paste', cut, fctx())!;
    expect(back).toMatchObject({ controls: [{ name: 'txtTotal', children: [{ name: 'lblTotal' }] }] });
    expect(clipboardAction('paste', s, fctx())).toMatchObject({ controls: [{ name: 'Texte1', children: [{ name: 'Étiquette1' }] }] });
  });

  it('a line (zero height or width) counts in the overlap: pasted in its own section, it goes below the original', () => {
    for (const [w, h] of [[2268, 0], [0, 567]]) {
      const doc: DesignDoc = { ...report(), sections: [{ kind: 'detail', height: 1134, props: {}, controls: [{ kind: 'line', name: 'Trait1', left: 0, top: 100, width: w, height: h, props: {} }] }] };
      const out = pasteControls(doc, copySelection(doc, { kind: 'controls', names: ['Trait1'] })!, 0, { ...rctx, kinds: ['line'] })!;
      expect(out[0].top).toBeGreaterThanOrEqual(100 + Math.max(h, gridStep(doc)));   // a visible move, not 1 twip
    }
  });

  it('nothing selected (after a cut): back to the section the clip came from, if the target has it, else the Detail', () => {
    const s = sel(form(), 'Étiquette2');
    const cut = designerReducer(s, clipboardAction('cut', s, fctx())!);
    expect(cut.selection).toEqual({ kind: 'doc' });
    expect(clipboardAction('paste', cut, fctx())).toMatchObject({ section: 0, controls: [{ name: 'Étiquette2' }] });
    expect(clipboardAction('paste', initDesigner(report(), 'report'), rctx)).toMatchObject({ section: 1 });   // no form header in a report
    const hidden = (props: Record<string, unknown>, height: number) => initDesigner({ ...form(), sections: form().sections.map((x, i) => (i === 0 ? { ...x, props, height } : x)) }, 'form');
    expect(clipboardAction('paste', hidden({ Visible: false }, 567), fctx())).toMatchObject({ section: 1 });   // hidden header: the Detail
    expect(clipboardAction('paste', hidden({}, 0), fctx())).toMatchObject({ section: 1 });
  });

  it('Paste is possible only with a clip holding a kind the target has', () => {
    clipboardAction('copy', sel(form(), 'Bouton1'), fctx());
    expect([canPaste(FORM_KINDS), canPaste(rctx.kinds)]).toEqual([true, false]);
    // Home › Paste stays enabled for the Navigation Pane's object clipboard
    expect(pasteEnabled(rctx.kinds)).toBe(false);
    setClip({ kind: 'form', name: 'A', cut: false });
    expect(pasteEnabled(rctx.kinds)).toBe(true);
    setClip(null);
  });

  it('a control taken out of a tab page loses its PageIndex; a copied tab control keeps its pages', () => {
    const doc: DesignDoc = { ...form(), sections: form().sections.map((x, i) => (i === 2 ? { ...x, height: 2000, controls: [
      { kind: 'tabControl', name: 'Onglet1', left: 0, top: 0, width: 5000, height: 1500, props: { Pages: ['A', 'B'] },
        children: [ctl('textBox', 'Dedans', 100, 400, { PageIndex: 1 })] }] } : x)) };
    const [alone] = pasteControls(doc, copySelection(doc, { kind: 'controls', names: ['Dedans'] })!, 1, fctx())!;
    expect(alone.props).not.toHaveProperty('PageIndex');
    const [tabs] = pasteControls(doc, copySelection(doc, { kind: 'controls', names: ['Onglet1'] })!, 1, fctx())!;
    expect(tabs.children![0].props.PageIndex).toBe(1);
  });
});
