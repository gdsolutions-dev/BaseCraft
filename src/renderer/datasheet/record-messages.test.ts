import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../shared/i18n/en.json';
import fr from '../../shared/i18n/fr.json';
import { defaultProps, type FieldDef, type FieldProps } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import type { ModalApi, ConfirmOptions } from '../shell/Modal';
import { confirmDelete, deleteMessageKey, fieldErrorParams } from './record-messages';

const i18n = i18next.createInstance();
void i18n.init({ resources: { fr: { translation: fr }, en: { translation: en } }, lng: 'fr', interpolation: { escapeValue: false }, initAsync: false });
const t = i18n.t.bind(i18n);
const fd = (name: string, props: Partial<FieldProps> = {}): FieldDef => ({ name, props: { ...defaultProps('shortText'), ...props } as FieldProps });
const fr_ = { lang: 'fr', region: localeInfo('fr-FR') } as const;

describe('record messages', () => {
  it('delete message follows the real cascade effects (A2-R14, A2-R15)', () => {
    expect(deleteMessageKey([])).toBe('datasheet.delete');
    expect(deleteMessageKey(['deleted'])).toBe('datasheet.deleteCascade');
    expect(deleteMessageKey(['modified'])).toBe('datasheet.deleteModifies');
    expect(deleteMessageKey(['modified', 'deleted'])).toBe('datasheet.deleteCascadeModifies');
  });

  it('field error words', () => {
    expect(fieldErrorParams({ field: 'Ville', code: 'validation', message: 'Ville interdite' }, fd('Ville'), fr_, t)).toEqual({ field: 'Ville', message: 'Ville interdite' });
    expect(fieldErrorParams({ field: 'Qté', code: 'validation' }, fd('Qté', { caption: 'Quantité', validationRule: '> 0.5' }), fr_, t))
      .toEqual({ field: 'Quantité', message: t('fieldError.validation', { rule: '> 0,5' }) });
  });

  it('the table rule: no field, its own text, else Access\'s sentence with the rule in display form (or without it, unknown)', () => {
    const e = { field: '', code: 'validation' as const, table: 'Commandes' };
    expect(fieldErrorParams({ ...e, message: 'Non' }, undefined, fr_, t)).toEqual({ field: '', message: 'Non', context: 'record' });
    const p = fieldErrorParams(e, undefined, fr_, t, { validationRule: '[A] > 0.5' });
    expect(p.message).toBe(t('fieldError.tableRule', { rule: '[A] > 0,5', table: 'Commandes' }));
    expect(t('datasheet.fieldError', p)).toBe(p.message);
    expect(fieldErrorParams(e, undefined, fr_, t).message).toBe(t('fieldError.tableRule', { table: 'Commandes', context: 'short' }));
    // a rule that cannot be computed (type mismatch, a field dropped by another tool): the table's words, no empty quotes
    const err = fieldErrorParams({ field: '', code: 'expressionError', table: 'Commandes' }, undefined, fr_, t);
    expect(err).toEqual({ field: '', message: t('fieldError.tableRuleError', { table: 'Commandes' }), context: 'record' });
    expect(t('datasheet.fieldError', err)).toBe(err.message);
  });

  it('code words: the table for noParent, unnamed related, a control rule without its own text', () => {
    expect(fieldErrorParams({ field: 'Client', code: 'noParent', table: 'Clients' }, undefined, fr_, t).message).toBe(t('fieldError.noParent', { table: 'Clients' }));
    expect(fieldErrorParams({ field: 'N°', code: 'related' }, undefined, fr_, t).message).toBe(fr.fieldError.related_unnamed);
    expect(fieldErrorParams({ field: 'Nom', code: 'controlValidation' }, fd('Nom'), fr_, t)).toEqual({ field: 'Nom', message: fr.form.controlValidation });
    expect(fieldErrorParams({ field: 'Client', code: 'noMaster' }, undefined, fr_, t)).toEqual({ field: 'Client', message: fr.form.subform.noMaster });
  });

  it('confirmDelete asks with the cascade effects, No by default; without them when cascadeChildren fails', async () => {
    const asked: ConfirmOptions[] = [];
    const modal = { confirm: async (o: ConfirmOptions) => { asked.push(o); return 'yes' as const; } } as unknown as ModalApi;
    const relations = (r: () => Promise<{ table: string; effect: 'deleted' | 'modified' }[]>) => ({ cascadeChildren: r });
    expect(await confirmDelete(modal, 'Clients', 1, relations(async () => [{ table: 'Commandes', effect: 'deleted' }]))).toBe(true);
    expect(await confirmDelete(modal, 'Clients', 2, relations(() => Promise.reject(new Error('x'))))).toBe(true);
    expect(asked).toEqual([
      { titleKey: 'datasheet.deleteTitle', messageKey: 'datasheet.deleteCascade', params: { count: 1 }, buttons: ['yes', 'no'], defaultButton: 'no' },
      { titleKey: 'datasheet.deleteTitle', messageKey: 'datasheet.delete', params: { count: 2 }, buttons: ['yes', 'no'], defaultButton: 'no' },
    ]);
  });
});
