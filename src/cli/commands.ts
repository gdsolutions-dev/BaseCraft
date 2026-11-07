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
    description: 'Relates the parent fields (a unique key) to the child fields. Both tables must already exist. name defaults to ParentChild; enforce defaults to true, cascadeUpdate and cascadeDelete to false, joinType to 1. As in Access, the tables are not added to the Relationships window layout: open the window and click All Relationships to see them.',
  },
  {
    id: 'query.create',
    label: 'Create query',
    params: 'name: string; sql: string; description?: string',
    description: 'Creates a saved select or union query over local tables or other saved queries, validated as the application validates a save. Action (UPDATE, DELETE, INSERT, SELECT INTO) and crosstab (TRANSFORM) queries are refused, as are queries over missing tables or that refer to themselves.',
  },
  {
    id: 'form.create',
    label: 'Create form',
    params: "name: string; layout: 'auto'|'doc'; recordSource?: { kind: 'table'|'query', name: string } | { kind: 'sql', sql: string }; doc?: design document; description?: string",
    description: "Creates a form: layout 'auto' (needs recordSource) is the application's instant form, a single column with a bound control and label per field; layout 'doc' takes a full design document in doc (its own recordSource, or null), validated as the application validates it, and every ControlSource must be a field of the record source or an expression (=...).",
  },
  {
    id: 'report.create',
    label: 'Create report',
    params: "name: string; layout: 'auto'|'doc'; recordSource?: { kind: 'table'|'query', name: string } | { kind: 'sql', sql: string }; doc?: design document; lang?: 'fr'|'en'; description?: string",
    description: "Creates a report: layout 'auto' (needs recordSource) is the application's instant report, tabular with one column per field and its texts in lang (default en); layout 'doc' takes a full design document in doc, validated like form.create's.",
  },
];
