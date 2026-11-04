export interface CommandInfo { id: string; label: string; params: string; description: string }

export const COMMANDS: CommandInfo[] = [
  {
    id: 'table.create',
    label: 'Create a table',
    params: 'name: string; description?: string; fields: [{ name: string, type: autoNumber|shortText|longText|number|currency|dateTime|yesNo|hyperlink, ...field properties }]',
    description: 'Creates a table with its fields. Refused when the name is invalid or already taken, or when a field definition is invalid.',
  },
  {
    id: 'relation.create',
    label: 'Create a relation',
    params: 'parentTable: string; parentFields: string[]; childTable: string; childFields: string[]; name?: string; enforce?: boolean; cascadeUpdate?: boolean; cascadeDelete?: boolean; joinType?: 1|2|3',
    description: 'Relates the parent fields (a unique key) to the child fields. Both tables must already exist. name defaults to ParentChild; enforce defaults to true, cascadeUpdate and cascadeDelete to false, joinType to 1.',
  },
];
