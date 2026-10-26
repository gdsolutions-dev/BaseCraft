import { afterEach, describe, expect, it } from 'vitest';
import type { DesignDoc } from '../../shared/design/model';
import { emptyMacro, type MacroDef } from '../../shared/macro/model';
import type { DesignerAction } from '../designer/designer-model';
import type { AppAction } from '../state/app-state';
import { closeEmbeddedOf, dropEmbedded, embeddedSession, eventSession, openEmbedded } from './embedded';

const def: MacroDef = { formatVersion: '1.0', items: [{ k: 'action', action: 'MessageBox', args: { Message: 'x' } }] };
const form = (name: string): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
  { kind: 'detail', height: 1000, props: {}, controls: [{ kind: 'commandButton', name, left: 0, top: 0, width: 1000, height: 300, props: {} }] }] });

const opened: string[] = [];
afterEach(() => { opened.splice(0).forEach(dropEmbedded); });
/** Opens a session, returns the actions dispatched to the shell and the session id. */
function open(owner: string, title: string, save: (d: MacroDef) => boolean = () => true) {
  const sent: AppAction[] = [];
  openEmbedded((a) => { sent.push(a); }, { owner, title, def: emptyMacro(), save });
  const a = sent[0] as Extract<AppAction, { type: 'open' }>;
  opened.push(a.embedded!.id);
  return { sent, id: a.embedded!.id };
}

describe('embedded macro sessions (R16)', () => {
  it('save writes { embedded: def } into the captured target with setProp; a target gone since refuses', () => {
    let doc: DesignDoc | null = form('cmdCommandes');
    const sent: DesignerAction[] = [];
    const s = eventSession({ owner: 'doc1', title: 'FClients : cmdCommandes : Sur clic', def: emptyMacro(), target: { kind: 'control', name: 'cmdCommandes' },
      event: 'OnClick', doc: () => doc, dispatch: (a) => sent.push(a) });
    expect(s.save(def)).toBe(true);
    expect(sent).toEqual([{ type: 'setProp', targets: [{ kind: 'control', name: 'cmdCommandes' }], name: 'OnClick', value: { embedded: def } }]);
    doc = form('cmdAutre');   // renamed
    expect(s.save(def)).toBe(false);
    doc = null;               // the design gone
    expect(s.save(def)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('openEmbedded: a macro tab in Design view named by the title; the same object, control and event reuse their session', () => {
    const a = open('doc1', 'FClients : Formulaire : Avant MAJ');
    expect(a.sent).toEqual([{ type: 'open', kind: 'macro', name: 'FClients : Formulaire : Avant MAJ', mode: 'design', embedded: { id: a.id, owner: 'doc1' } }]);
    expect(embeddedSession(a.id)?.title).toBe('FClients : Formulaire : Avant MAJ');
    expect(open('doc1', 'FClients : Formulaire : Avant MAJ').id).toBe(a.id);
    dropEmbedded(a.id);
    expect(embeddedSession(a.id)).toBeUndefined();
  });

  it('closeEmbeddedOf lists only that owner\'s sessions', () => {
    const a = open('doc1', 'F : Formulaire : Sur ouverture');
    const b = open('doc2', 'G : Formulaire : Sur ouverture');
    const c = open('doc1', 'F : cmd : Sur clic');
    expect(closeEmbeddedOf('doc1').sort()).toEqual([a.id, c.id].sort());
    expect(closeEmbeddedOf('doc2')).toEqual([b.id]);
    expect(closeEmbeddedOf('doc3')).toEqual([]);
  });
});
