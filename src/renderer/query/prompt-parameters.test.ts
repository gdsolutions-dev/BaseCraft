import { expect, it, vi } from 'vitest';
import { num } from '../../shared/expr/library';
import { defaultProps } from '../../shared/field-types';
import { registerForm, type FormInstance } from '../form/form-instances';
import { tempVars } from '../macro/temp-vars';
import { localeInfo } from '../../shared/locale-format';
import { i18n } from '../i18n';
import type { ModalApi, PromptOptions } from '../shell/Modal';
import { promptParameters, runParameters } from './prompt-parameters';

const fr = localeInfo('fr-FR');
/** Answers the prompts in turn; records each label's name and the last validate. */
function fakeModal(answers: (string | null)[]) {
  const m = {
    labels: [] as string[],
    lastValidate: undefined as PromptOptions['validate'],
    prompt: async (o: PromptOptions) => {
      expect(o).toMatchObject({ titleKey: 'query.param.title', labelKey: 'query.param.label' });
      m.labels.push((o.labelParams as { name: string }).name);
      m.lastValidate = o.validate;
      return answers.shift() ?? null;
    },
    confirm: async () => 'ok' as const,
    custom: async () => null,
  };
  return m as typeof m & ModalApi;
}

it('asks each parameter in order and returns raw text', async () => {
  const m = fakeModal(['05/10/2026', '1,5']);
  expect(await promptParameters(m, [{ name: 'Du', type: 'dateTime' }, { name: 'Mini', type: 'currency' }], fr)).toEqual({ Du: '05/10/2026', Mini: '1,5' });
  expect(m.labels).toEqual(['Du', 'Mini']); // read from labelParams.name
});

it('validates with the type and props', async () => {
  const m = fakeModal(['31/02/2026']);
  await promptParameters(m, [{ name: 'Du', type: 'dateTime' }], fr);
  expect(m.lastValidate!('31/02/2026')).toBe(i18n.t('fieldError.invalidDate'));
  expect(m.lastValidate!('xyz')).toBe(i18n.t('fieldError.invalidDate'));
  expect(m.lastValidate!('05/10/2026')).toBeNull();
  const b = fakeModal(['300']);
  await promptParameters(b, [{ name: 'N', type: 'number', props: { ...defaultProps('number'), numberSize: 'byte', required: false } }], fr);
  expect(b.lastValidate!('300')).toBe(i18n.t('fieldError.outOfRange'));
  expect(b.lastValidate!('')).toBeNull(); // an empty value is Null, as in Access
});

it('a parameter named like an i18n key keeps its name', async () => {
  const m = fakeModal(['x']);
  await promptParameters(m, [{ name: 'nav.tables', type: null }], fr);
  expect(m.labels).toEqual(['nav.tables']);
});

it('cancel returns null', async () => expect(await promptParameters(fakeModal([null]), [{ name: 'Du', type: null }], fr)).toBeNull());

it('cancel on a later prompt returns null and asks no more', async () => {
  const m = fakeModal(['a', null, 'c']);
  expect(await promptParameters(m, [{ name: 'A', type: null }, { name: 'B', type: null }, { name: 'C', type: null }], fr)).toBeNull();
  expect(m.labels).toEqual(['A', 'B']);
});

it('fills form references and TempVars, asks the rest', async () => {
  const form = { name: 'FClients', tabId: 't1', value: (c: string) => (c === 'N°' ? num(2) : null) } as unknown as FormInstance;
  const off = registerForm(form);
  tempVars.set('seuil', num(50));
  const m = fakeModal(['01/10/2026']);
  const out = await promptParameters(m, [{ name: '[Forms]![FClients]![N°]', type: 'number' }, { name: 'Date début :', type: 'dateTime' },
    { name: '[TempVars]![Seuil]', type: 'currency' }, { name: '[TempVars]![Absente]', type: null }], fr);
  expect(m.labels).toEqual(['Date début :']);
  expect(out).toEqual({ '[Forms]![FClients]![N°]': 2, 'Date début :': '01/10/2026', '[TempVars]![Seuil]': 50, '[TempVars]![Absente]': null });
  off();
  tempVars.clear();
  const closed = fakeModal(['3']);
  expect(await promptParameters(closed, [{ name: '[Forms]![FClients]![N°]', type: 'number' }], fr)).toEqual({ '[Forms]![FClients]![N°]': '3' });
  expect(closed.labels).toEqual(['[Forms]![FClients]![N°]']); // not open: asked, the reference as its label (Access)
});

it('a crosstab whose headings need the parameters (B4 R11): asked once, then described again with the values', async () => {
  const m = fakeModal(['01/10/2026']);
  const describe = vi.fn(async () => ({ fields: [], updatable: false, parameters: [] }));
  const values = await runParameters(m, { fields: [], updatable: false, parameters: [{ name: 'Du', type: 'dateTime' }], crosstab: { headings: 'needsParameters' } }, fr, describe);
  expect(values).toEqual({ Du: '01/10/2026' });
  expect(m.labels).toEqual(['Du']);
  expect(describe).toHaveBeenCalledTimes(1);
  expect(describe).toHaveBeenCalledWith({ Du: '01/10/2026' });
  // headings known (IN, or the data with no parameter), or a plain query: no second describe; cancel: none either
  for (const crosstab of [{ headings: 'fixed' as const }, { headings: 'data' as const }, undefined]) {
    describe.mockClear();
    expect(await runParameters(fakeModal(['x']), { fields: [], updatable: false, parameters: [{ name: 'P', type: null }], ...(crosstab && { crosstab }) }, fr, describe)).toEqual({ P: 'x' });
    expect(describe).not.toHaveBeenCalled();
  }
  expect(await runParameters(fakeModal([null]), { fields: [], updatable: false, parameters: [{ name: 'Du', type: null }], crosstab: { headings: 'needsParameters' } }, fr, describe)).toBeNull();
  expect(describe).not.toHaveBeenCalled();
});
