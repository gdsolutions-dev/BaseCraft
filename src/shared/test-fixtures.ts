import { defaultProps, type FieldDef, type FieldProps, type FieldType, type TableDesign } from './field-types'

export const f = (name: string, type: FieldType, overrides: Partial<FieldProps> = {}): FieldDef =>
  ({ name, props: { ...defaultProps(type), ...overrides } })

export const t = (name: string, fields: FieldDef[]): TableDesign => ({ name, fields })

export const clients: TableDesign = t('Clients', [
  f('N°', 'autoNumber'),
  f('Nom', 'shortText', { size: 50, required: true }),
  f('Âge', 'number', { numberSize: 'byte' }),
  f('Actif', 'yesNo'),
  f('Solde', 'currency'),
  f('Email', 'shortText', { indexed: 'yesNoDuplicates' })
])
