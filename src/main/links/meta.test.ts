import { describe, expect, it } from 'vitest';
import type { FieldDef, FieldProps, TableDesign } from '../../shared/field-types';
import { f, t } from '../../shared/test-fixtures';
import type { RemoteTable } from '../connectors/connector';
import { linkMeta, withMetadata, type LinkMeta, type TypeKey } from './meta';

// R11: a server-read design and the local design's metadata overlaid on it.
const decimal = (precision: number, scale: number): TypeKey => ({ type: 'number', numberSize: 'decimal', precision, scale });
/** A field as a connector reads it back: its type keys and the server's own props only. */
const server = (name: string, k: TypeKey, more: Partial<FieldProps> = {}): FieldDef =>
  ({ name, props: { required: false, indexed: 'no', primaryKey: false, ...k, ...more } as FieldProps });
const serverDesign = (cols: Record<string, TypeKey>): TableDesign => t('Commandes', Object.entries(cols).map(([n, k]) => server(n, k)));
const meta = (fields: LinkMeta['fields'], table?: LinkMeta['table']): LinkMeta => ({ fields, ...(table ? { table } : {}) });

describe('withMetadata (R11)', () => {
  it('a PostgreSQL numeric(19,4) read back as Decimal shows as Currency with its caption and rule', () => {
    const d = withMetadata(serverDesign({ Montant: decimal(19, 4) }), meta({ Montant: { props: { type: 'currency', caption: 'Montant TTC', validationRule: '>0' }, from: decimal(19, 4) } }));
    expect(d.fields[0]!.props).toMatchObject({ type: 'currency', caption: 'Montant TTC', validationRule: '>0' });
    expect(d.fields[0]!.props).not.toHaveProperty('numberSize'); // the server's type keys go with its type
    expect(d.fields[0]!.props).not.toHaveProperty('precision');
  });

  it('a column changed on the server keeps its own type, the presentation stays', () => {
    const d = withMetadata(serverDesign({ Montant: { type: 'longText' } }),
      meta({ Montant: { props: { type: 'currency', decimalPlaces: 2, caption: 'Montant TTC', validationRule: '>0' }, from: decimal(19, 4) } }));
    expect(d.fields[0]!.props).toMatchObject({ type: 'longText', caption: 'Montant TTC', validationRule: '>0' });
  });

  it('required, primaryKey and connector props stay the server\'s', () => {
    const d = withMetadata(t('Clients', [server('id', { type: 'autoNumber' }, { primaryKey: true, external: true, pgGenerated: true })]),
      meta({ id: { props: { type: 'autoNumber', caption: 'N°', required: true, primaryKey: false, pgGenerated: false, external: false } as Partial<FieldProps>, from: { type: 'autoNumber' } } }));
    expect(d.fields[0]!.props).toEqual({ required: false, indexed: 'no', primaryKey: true, type: 'autoNumber', external: true, pgGenerated: true, caption: 'N°' });
  });

  it('the table\'s rule and description; a field without metadata, or none at all, is the server\'s', () => {
    const plain = serverDesign({ Montant: decimal(19, 4), Note: { type: 'longText' } });
    expect(withMetadata(plain, undefined)).toBe(plain);
    const d = withMetadata(plain, meta({ Montant: { props: { caption: 'M' }, from: decimal(19, 4) } }, { validationRule: '[Montant] > 0', validationText: 'Non', description: 'Ventes' }));
    expect(d).toMatchObject({ name: 'Commandes', validationRule: '[Montant] > 0', validationText: 'Non', description: 'Ventes' });
    expect(d.fields[1]).toEqual(plain.fields[1]);
  });

  it('a merged field usableProps refuses keeps its own props', () => {
    const plain = serverDesign({ Montant: decimal(19, 4) });
    const d = withMetadata(plain, meta({ Montant: { props: { type: 'nope' as FieldProps['type'], caption: 'M' }, from: decimal(19, 4) } }));
    expect(d.fields[0]).toEqual(plain.fields[0]);
  });
});

describe('linkMeta (R11)', () => {
  it('the local props of META_KEYS and TYPE_KEYS, `from` as the server read the field; the table\'s rule', () => {
    const local: TableDesign = { ...t('Commandes', [
      f('N°', 'autoNumber'), f('Montant', 'currency', { caption: 'Montant TTC', validationRule: '>0', validationText: 'Positif', required: true }),
      f('Code', 'shortText', { size: 10, inputMask: '>LL', lookup: { kind: 'values', values: ['A', 'B'], limitToList: true } }),
    ]), validationRule: '[Montant] < 1000', description: 'Les commandes' };
    const linked: RemoteTable = { name: 'Commandes', remote: 'Commandes', schema: 'public', key: ['N°'], skipped: [],
      design: t('Commandes', [server('N°', { type: 'autoNumber' }, { primaryKey: true }), server('Montant', decimal(19, 4), { required: true }), server('Code', { type: 'shortText', size: 10 })]) };
    const m = linkMeta(local, linked);
    expect(m.table).toEqual({ validationRule: '[Montant] < 1000', description: 'Les commandes' });
    expect(m.fields.Montant).toEqual({ props: { type: 'currency', decimalPlaces: 2, caption: 'Montant TTC', validationRule: '>0', validationText: 'Positif', indexed: 'no' }, from: decimal(19, 4) });
    expect(m.fields.Code!.props).toMatchObject({ size: 10, inputMask: '>LL', lookup: { kind: 'values', values: ['A', 'B'], limitToList: true }, allowZeroLength: true });
    expect(m.fields.Code!.props).not.toHaveProperty('required');
    const back = withMetadata(linked.design, m); // read back through the link: the local design's presentation and rules
    expect(back.fields.map((x) => x.props.type)).toEqual(['autoNumber', 'currency', 'shortText']);
    expect(back.validationRule).toBe('[Montant] < 1000');
  });
});
