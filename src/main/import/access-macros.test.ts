import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ExportDesign } from '../../shared/access-export';
import type { DesignDoc } from '../../shared/design/model';
import { readEvent } from '../../shared/design/events';
import { parseMacroDef } from '../../shared/macro/model';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { getObject, saveObject } from '../db/objects';
import { readAccessExport, readExportMacros } from './access-export';
import { importDesigns } from './access-designs';
import { importMacros, macroLines } from './access-macros';

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const FIXTURE = join(__dirname, '../../../tests/fixtures/access/Ventes-complet.export');
const rowText = (action: string, ...args: string[]) => `Begin\n  Action ="${action}"\n${args.map((a) => `  Argument ="${a}"\n`).join('')}End\n`;
const macro = (name: string, ...rows: string[]) => ({ name, text: `Version =196611\n${rows.join('')}` });
const form = (name: string, body: string): ExportDesign => ({ kind: 'form', name, text: `Begin Form\n Begin\n  Begin Section\n   Begin\n${body}\n   End\n  End\n End\nEnd\n` });
const none = { tables: [], queries: [], forms: [], reports: [] };
const events = (db: DatabaseSync, name: string) => (getObject(db, 'form', name)!.definition as DesignDoc).sections[0]!.controls.map((c) => readEvent(c.props.OnClick));
let db: DatabaseSync;
beforeEach(() => { db = memoryBase(); });

describe('importMacros', () => {
  it('the fixture macro is saved and readable back', () => {
    const read = readAccessExport(FIXTURE, 'Ventes-complet.accdb');
    if (!read.ok) throw new Error('fixture');
    const r = importMacros(db, readExportMacros(FIXTURE, read.export), none);
    expect(r.macros).toEqual([{ name: 'MOuvrirEtat', remote: 'MOuvrirEtat' }]);
    expect(r.lines).toEqual([{ code: 'macroImported', object: 'MOuvrirEtat' }]);
    const def = parseMacroDef(getObject(db, 'macro', 'MOuvrirEtat')!.definition);
    expect(def?.items).toEqual([{ k: 'action', action: 'OpenReport', args: { ReportName: 'ECommandes', View: 'preview' } }]);
  });

  it('a taken name is numbered; a form of this import and a RunMacro of this import follow it', () => {
    saveObject(db, 'macro', 'M1', { formatVersion: '1.0', items: [] }, null);
    const f = importDesigns(db, [form('F', '    Begin CommandButton\n     Name ="B"\n     OnClick ="M1.Sub"\n    End')], { tables: [], queries: [] });
    const r = importMacros(db, [macro('M1', rowText('Beep')), macro('M2', rowText('RunMacro', 'M1', '', ''))], { ...none, forms: f.forms });
    expect(r.macros).toEqual([{ name: 'M11', remote: 'M1' }, { name: 'M2', remote: 'M2' }]);
    expect(r.lines).toContainEqual({ code: 'macroImported', object: 'M11', part: 'M1' });
    expect(events(db, 'F')).toEqual([{ kind: 'macro', name: 'M11.Sub' }]);
    expect(JSON.stringify(getObject(db, 'macro', 'M2')!.definition)).toContain('"M11"');
  });

  it('an embedded macro of a form follows a renamed macro', () => {
    saveObject(db, 'macro', 'M1', { formatVersion: '1.0', items: [] }, null);
    const body = '    Begin CommandButton\n     Name ="B"\n     OnClickEmMacro = Begin\n      Version =196611\n      Begin\n       Action ="RunMacro"\n       Argument ="M1"\n      End\n     End\n    End';
    const f = importDesigns(db, [form('F', body)], { tables: [], queries: [] });
    importMacros(db, [macro('M1', rowText('Beep'))], { ...none, forms: f.forms });
    const [b] = events(db, 'F');
    expect(b!.kind === 'embedded' && JSON.stringify(b.def)).toContain('"M11"');
  });

  it('an event written in another case than the macro name follows the numbered macro', () => {
    saveObject(db, 'macro', 'M1', { formatVersion: '1.0', items: [] }, null);
    const f = importDesigns(db, [form('F', '    Begin CommandButton\n     Name ="B"\n     OnClick ="m1.Sub"\n    End')], { tables: [], queries: [] });
    importMacros(db, [macro('M1', rowText('Beep'))], { ...none, forms: f.forms });
    expect(events(db, 'F')).toEqual([{ kind: 'macro', name: 'M11.Sub' }]);
  });

  it('a saved macro: every kind of object it opens follows the name this import gave', () => {
    saveObject(db, 'macro', 'M1', { formatVersion: '1.0', items: [] }, null);
    const n = (remote: string, name: string) => [{ remote, name }];
    const known = { tables: n('T', 'T_tab'), queries: n('Q', 'Q_qry'), forms: n('F', 'F_frm'), reports: n('R', 'R_rpt') };
    importMacros(db, [macro('M1', rowText('Beep')), macro('M2', rowText('OpenForm', 'F'), rowText('OpenReport', 'R', '2'), rowText('OpenQuery', 'Q'), rowText('OpenTable', 'T'), rowText('OnError', '1', 'M1'))], known);
    expect(parseMacroDef(getObject(db, 'macro', 'M2')!.definition)?.items.map((i) => (i.k === 'action' ? Object.values(i.args).filter((v) => /_|M11/.test(v)) : []))).toEqual([['F_frm'], ['R_rpt'], ['Q_qry'], ['T_tab'], ['M11']]);
  });

  it('unreadable, duplicate and unconvertible texts give one line each', () => {
    const r = importMacros(db, [{ name: 'A', text: null }, macro('B', rowText('Beep')), macro('b', rowText('Beep')), { name: 'C', text: 'Begin Form\nEnd\n' }], none);
    expect(r.lines.filter((l) => l.code === 'macroSkipped')).toEqual([
      { code: 'macroSkipped', object: 'A', reason: 'unreadable' }, { code: 'macroSkipped', object: 'b', reason: 'duplicate' }, { code: 'macroSkipped', object: 'C', reason: 'notRead' }]);
    expect(r.macros).toEqual([{ name: 'B', remote: 'B' }]);
  });

  it('an action BaseCraft does not know is kept as a comment and counted', () => {
    const r = importMacros(db, [macro('M', rowText('RunCommand', '4'), rowText('RunCommand', '4'))], none);
    expect(r.lines).toContainEqual({ code: 'macroActionComment', object: 'M', part: 'RunCommand', n: 2 });
  });
});

describe('macroLines', () => {
  it('lines of an embedded macro carry the reason embedded', () => {
    expect(macroLines('F', [{ code: 'elseLost', part: 'B.OnClick' }], true)).toEqual([{ code: 'macroElseLost', object: 'F', part: 'B.OnClick', reason: 'embedded' }]);
  });
  it('counts comments and merges the same note', () => {
    expect(macroLines('F', [{ code: 'actionComment', part: 'X' }, { code: 'actionComment', part: 'X' }, { code: 'elseLost' }, { code: 'elseLost' }]))
      .toEqual([{ code: 'macroActionComment', object: 'F', part: 'X', n: 2 }, { code: 'macroElseLost', object: 'F' }]);
  });
});
