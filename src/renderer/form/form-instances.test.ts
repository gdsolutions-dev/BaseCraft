import { afterEach, expect, it } from 'vitest';
import { ExprRuntimeError, type Value } from '../../shared/expr/ast';
import { num, str } from '../../shared/expr/library';
import { formCancelled, formNamed, formOfTab, formReady, memberParamValue, registerForm, registerReport, resolveObjectMember,
  whenFormOpened, type FormInstance } from './form-instances';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });

/** A form whose controls hold `values`; every other method is unused here. */
function stub(name: string, values: Record<string, Value>, tabId = `t-${name}`): FormInstance {
  const no = (): never => { throw new Error('unused'); };
  return {
    name, tabId,
    value: (c) => { const k = Object.keys(values).find((x) => x.toLowerCase() === c.toLowerCase()); if (k === undefined) throw new ExprRuntimeError('unknownField'); return values[k]!; },
    setValue: no, setProperty: no, goToRecord: no, goToControl: no, applyFilter: no, showAllRecords: no, find: no, requery: no,
    saveRecord: no, undoRecord: no, deleteRecord: no, refreshRecord: no,
  };
}

it('resolves an open form, refuses a closed one', async () => {
  const off = registerForm(stub('FClients', { Nom: str('Dupont') }));
  expect(await resolveObjectMember(['Forms', 'fclients', 'Nom'])).toEqual(str('Dupont'));
  off();
  await expect(resolveObjectMember(['Forms', 'FClients', 'Nom'])).rejects.toMatchObject({ code: 'notOpen', detail: 'FClients' });
});

it('a second registration replaces the first; the first one\'s release leaves it', () => {
  const offA = registerForm(stub('F', { x: num(1) }, 'a'));
  offs.push(registerForm(stub('f', { x: num(2) }, 'b')));
  offA();
  expect(formNamed('F')?.tabId).toBe('b');
  expect(formOfTab('b')?.name).toBe('f');
  expect(formOfTab('a')).toBeUndefined();
});

it('reports resolve while registered', async () => {
  const off = registerReport({ name: 'EVentes', value: () => num(3) });
  expect(await resolveObjectMember(['Reports', 'EVentes', 'Total'])).toEqual(num(3));
  off();
  await expect(resolveObjectMember(['Reports', 'EVentes', 'Total'])).rejects.toMatchObject({ code: 'notOpen' });
});

it('whenFormOpened resolves on registration and rejects on cancel', async () => {
  const opened = whenFormOpened('FClients');
  offs.push(registerForm(stub('FClients', {})));
  formReady('fclients');
  expect((await opened).name).toBe('FClients');
  expect((await whenFormOpened('FClients')).name).toBe('FClients'); // ready already: at once
  const cancelled = whenFormOpened('FAutre');
  formCancelled('FAutre');
  await expect(cancelled).rejects.toThrow('bc:actionCancelled');
});

it('memberParamValue: open form, TempVars (absent is Null), a closed form or another name is not found', () => {
  offs.push(registerForm(stub('FClients', { 'N°': num(2), Le: { t: 'date', v: 46299 }, Actif: { t: 'bool', v: true }, Vide: null })));
  const tv = new Map<string, Value>([['seuil', num(5)]]);
  expect(memberParamValue('[Forms]![FClients]![N°]', tv)).toEqual({ found: true, value: 2 });
  expect(memberParamValue('[Forms]![FClients]![Le]', tv)).toEqual({ found: true, value: '2026-10-04 00:00:00' });
  expect(memberParamValue('[Forms]![FClients]![Actif]', tv, 'yesNo')).toEqual({ found: true, value: true });
  expect(memberParamValue('[Forms]![FClients]![Vide]', tv)).toEqual({ found: true, value: null });
  expect(memberParamValue('[TempVars]![Seuil]', tv)).toEqual({ found: true, value: 5 });
  expect(memberParamValue('[TempVars]![Absente]', tv)).toEqual({ found: true, value: null });
  expect(memberParamValue('[Forms]![FAutre]![N°]', tv)).toEqual({ found: false });
  expect(memberParamValue('[Forms]![FClients]![Inconnu]', tv)).toEqual({ found: false }); // Access asks for it
  expect(memberParamValue('Date début :', tv)).toEqual({ found: false });
  expect(memberParamValue('Du', tv)).toEqual({ found: false });
});

it('memberParamValue: a Yes/No value is -1 / 0 for a parameter that is not Yes/No (Access)', () => {
  offs.push(registerForm(stub('F', { Oui: { t: 'bool', v: true }, Non: { t: 'bool', v: false } })));
  const tv = new Map<string, Value>();
  expect(memberParamValue('[Forms]![F]![Oui]', tv, 'long')).toEqual({ found: true, value: -1 });
  expect(memberParamValue('[Forms]![F]![Non]', tv)).toEqual({ found: true, value: 0 });   // no type: Text
  expect(memberParamValue('[Forms]![F]![Oui]', tv, 'yesNo')).toEqual({ found: true, value: true });
});
