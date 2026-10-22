import { GridCellKind, type EditableGridCell } from '@glideapps/glide-data-grid';
import { f, t } from '../../shared/test-fixtures';
import { defaultValues, fromEdit, inputCell, pasteAllowed, toCell } from './datasheet-cells';

const NBSP = String.fromCharCode(0xa0); // no-break space (currency)
const NNBSP = String.fromCharCode(0x202f); // narrow no-break space (fr-FR groups)
const ctx = { locale: 'fr-FR', readOnly: false };

describe('datasheet cells', () => {
  it('default values shown on the new record row, evaluated and converted as the write layer does', async () => {
    const d = t('T', [f('N°', 'autoNumber'), f('Q', 'number', { defaultValue: '1' }), f('Le', 'dateTime', { defaultValue: 'Date()' }),
      f('X', 'number', { defaultValue: '1 / 0' }), f('N', 'shortText'), f('Ok', 'yesNo', { defaultValue: 'True' })]);
    expect(await defaultValues(d, 'fr-FR', () => new Date(2026, 9, 21, 9))).toEqual([null, 1, '2026-10-21 00:00:00', null, null, 1]);
  });
  it('cells by type', () => {
    expect(toCell(f('A', 'yesNo'), 1, ctx).kind).toBe(GridCellKind.Boolean);
    expect(toCell(f('S', 'currency'), 12.5, ctx)).toMatchObject({ kind: GridCellKind.Text, displayData: `12,50${NBSP}€`, data: '12,5' });
    expect(toCell(f('L', 'dateTime'), '2026-10-21 00:00:00', ctx)).toMatchObject({ displayData: '21/10/2026', data: '21/10/2026' });
    expect(toCell(f('N°', 'autoNumber'), 3, ctx)).toMatchObject({ readonly: true });
    expect(toCell(f('Nom', 'shortText'), 'x', { ...ctx, readOnly: true })).toMatchObject({ readonly: true });
    expect(pasteAllowed({ rows: 2 })).toBe(false);
  });

  it('a text stored without its mask literals is shown through the mask; a value that does not match is shown as stored (A2-R10)', () => {
    const fd = f('D', 'shortText', { inputMask: '00/00/0000' });
    expect(toCell(fd, '21102026', ctx)).toMatchObject({ displayData: '21/10/2026', data: '21102026' });
    expect(toCell(fd, 'legacy', ctx)).toMatchObject({ displayData: 'legacy', data: 'legacy' });
    expect(toCell(f('D', 'shortText', { inputMask: '"', format: '>' }), 'ab', ctx)).toMatchObject({ displayData: 'AB' });
    // Format and mask: the format displays, the mask edits (Access); A2-R11 spaces show in place
    expect(toCell(f('D', 'shortText', { inputMask: '>LL', format: '<' }), 'AB', ctx)).toMatchObject({ displayData: 'ab', data: 'AB' });
    expect(toCell(f('D', 'shortText', { inputMask: '99-00' }), '1 23', ctx)).toMatchObject({ displayData: '1 -23', data: '1 23' });
  });

  it('yes/no reads the stored integer', () => {
    expect(toCell(f('A', 'yesNo'), 1, ctx)).toMatchObject({ data: true, readonly: false });
    expect(toCell(f('A', 'yesNo'), 0, ctx)).toMatchObject({ data: false });
    expect(toCell(f('A', 'yesNo'), 0, { ...ctx, readOnly: true })).toMatchObject({ readonly: true });
  });

  it('numbers: grouped display, regional edit text without grouping, every digit', () => {
    const d = toCell(f('Q', 'number', { numberSize: 'double' }), 1234567.25, ctx);
    expect(d).toMatchObject({ displayData: `1${NNBSP}234${NNBSP}567,25`, data: '1234567,25', contentAlign: 'right' });
    expect(toCell(f('Q', 'number', { numberSize: 'double' }), 0.1 + 0.2, ctx)).toMatchObject({ data: '0,30000000000000004' });
    expect(toCell(f('Q', 'number', { numberSize: 'double', decimalPlaces: 2 }), 3, ctx)).toMatchObject({ displayData: '3,00', data: '3' });
    const dec = toCell(f('D', 'number', { numberSize: 'decimal', precision: 28, scale: 2 }), '12345678901234567890.50', ctx);
    expect(dec).toMatchObject({ displayData: `12${NNBSP}345${NNBSP}678${NNBSP}901${NNBSP}234${NNBSP}567${NNBSP}890,50`, data: '12345678901234567890,50' });
    expect(toCell(f('Q', 'number'), 1234, { locale: 'de-DE', readOnly: false })).toMatchObject({ displayData: '1.234', data: '1234' });
  });

  it('dates keep their time in the edit text, in a form the region reads back', () => {
    expect(toCell(f('L', 'dateTime'), '2026-10-21 14:05:09', ctx)).toMatchObject({ data: '21/10/2026 14:05:09' });
    expect(toCell(f('L', 'dateTime'), '2026-10-21 14:05:09', { locale: 'en-US', readOnly: false })).toMatchObject({ data: '10/21/2026 14:05:09' });
  });

  it('null is an empty cell; text is shown as is', () => {
    expect(toCell(f('Nom', 'shortText'), null, ctx)).toMatchObject({ kind: GridCellKind.Text, displayData: '', data: '' });
    expect(toCell(f('S', 'currency'), null, ctx)).toMatchObject({ displayData: '', data: '' });
    expect(toCell(f('Nom', 'longText'), 'a\nb', ctx)).toMatchObject({ displayData: 'a\nb', data: 'a\nb', readonly: false });
  });

  it('a pending cell shows what was typed', () => {
    expect(inputCell(f('S', 'currency'), '12,5', ctx)).toMatchObject({ kind: GridCellKind.Text, data: '12,5', displayData: '12,5', readonly: false });
    expect(inputCell(f('A', 'yesNo'), true, ctx)).toMatchObject({ kind: GridCellKind.Boolean, data: true });
    expect(inputCell(f('Nom', 'shortText'), null, { readOnly: true })).toMatchObject({ data: '', readonly: true });
  });

  it('edits become inputs for the write layer', () => {
    expect(fromEdit(f('A', 'yesNo'), { kind: GridCellKind.Boolean, data: true, allowOverlay: false } as EditableGridCell)).toBe(true);
    expect(fromEdit(f('S', 'currency'), { kind: GridCellKind.Text, data: '12,5', displayData: '', allowOverlay: true } as EditableGridCell)).toBe('12,5');
    expect(pasteAllowed({ rows: 1 })).toBe(true);
  });

  it('cells use format for display only', () => {
    expect(toCell(f('S', 'number', { numberSize: 'double', format: 'fixed' }), 2.5, ctx)).toMatchObject({ displayData: '2,50', data: '2,5' });
    expect(toCell(f('S', 'number', { numberSize: 'double', format: 'fixed', decimalPlaces: 0 }), 2.5, ctx)).toMatchObject({ displayData: '3', data: '2,5' });
    expect(toCell(f('L', 'dateTime', { format: 'dddd d mmmm yyyy' }), '2026-10-21 14:05:09', ctx)).toMatchObject({ displayData: 'mercredi 21 octobre 2026', data: '21/10/2026 14:05:09' });
    expect(toCell(f('L', 'dateTime', { format: 'shortTime' }), '2026-10-21 14:05:09', ctx)).toMatchObject({ displayData: '14:05' });
    expect(toCell(f('N', 'shortText', { format: '>' }), 'Dupont', ctx)).toMatchObject({ displayData: 'DUPONT', data: 'Dupont' });
    expect(toCell(f('N', 'shortText', { format: '@;"(vide)"' }), null, ctx)).toMatchObject({ displayData: '(vide)', data: '' });
    expect(toCell(f('S', 'currency', { format: 'euro' }), 12.5, { ...ctx, locale: 'en-US' })).toMatchObject({ displayData: '€12.50', data: '12.5' });
  });

  it('an unusable format falls back to the plain display', () => {
    expect(toCell(f('S', 'number', { numberSize: 'double', format: '"x' }), 2.5, ctx)).toMatchObject({ displayData: `2,5`, data: '2,5' });
    expect(toCell(f('D', 'number', { numberSize: 'decimal', precision: 28, scale: 2, format: 'fixed' }), '12.50', ctx)).toMatchObject({ displayData: '12,50' });
    expect(toCell(f('L', 'dateTime', { format: 'fixed' }), 'not a date', ctx)).toMatchObject({ displayData: 'not a date' });
  });
});
