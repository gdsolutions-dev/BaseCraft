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
    description: "Creates a form: layout 'auto' (needs recordSource) is the application's instant form, a single column with a bound control and label per field; layout 'doc' takes a full design document in doc (its own recordSource, or null), validated as the application validates it, and every ControlSource must be a field of the record source or an expression (=...). Event properties (OnOpen, OnClick, ...) in a doc take a macro name, M.Sub or { embedded: macro } and are checked against the property sheet (the event must apply to that target); the macro must be created earlier in the same script. A Python handler =Name(...) (also =Name(1, 'x')) is accepted when exactly one module of the base, created earlier in the script (module.create) or already stored, defines the public top-level function Name; otherwise it is refused (not found, or defined by several modules). A built-in function name cannot be a handler. A chart control (kind 'chart', props ChartType, ChartSource, ChartAxis, ChartLegend, ChartValues: [{ field, agg }], ChartSeries: [{ field, name?, type?: column|line|area, secondary?, color? ... }], any ChartType) is refused when ChartType, an agg or a series type is unknown, a ChartSeries entry is malformed, a ChartValues entry has no field, or an axis, legend or value field is not in its source (ChartSource, else the document's record source); list them with basecraft-cli charts FILE.",
  },
  {
    id: 'report.create',
    label: 'Create report',
    params: "name: string; layout: 'auto'|'doc'; recordSource?: { kind: 'table'|'query', name: string } | { kind: 'sql', sql: string }; doc?: design document; lang?: 'fr'|'en'; description?: string",
    description: "Creates a report: layout 'auto' (needs recordSource) is the application's instant report, tabular with one column per field and its texts in lang (default en); layout 'doc' takes a full design document in doc, validated like form.create's. Event properties (OnOpen, OnClick, ...) in a doc take a macro name, M.Sub or { embedded: macro } and are checked against the property sheet (the event must apply to that target); the macro must be created earlier in the same script. A Python handler =Name(...) (also =Name(1, 'x')) is accepted when exactly one module of the base, created earlier in the script (module.create) or already stored, defines the public top-level function Name; otherwise it is refused (not found, or defined by several modules). A built-in function name cannot be a handler. A chart control (kind 'chart') is validated exactly as in form.create (same props; the link fields have no effect in a report); list them with basecraft-cli charts FILE.",
  },
  {
    id: 'rows.insert',
    label: 'Insert rows',
    params: 'table: string; rows: [{ field: value }] (value: string | number | boolean | null)',
    description: "Inserts rows into a local table through the application's write layer: conversions, default values, Required, validation rules, unique indexes and enforced relations apply as when a record is saved (input masks and Limit To List do not, as for any programmatic write). Text values are read in the canonical locale: numbers as 1234.5, dates as 2026-01-31 or 2026-01-31 14:30. An absent AutoNumber is numbered; a missing field takes its default. Refused, with the row and field, on the first row the application would refuse; linked tables are refused, and a validation rule or default value that calls a Python function fails as expressionError (the CLI has no Python engine).",
  },
  {
    id: 'macro.create',
    label: 'Create macro',
    params: 'name: string; items: macro items; description?: string',
    description: "Creates a macro from its items, the stored MacroDef.items: { k: 'action', action, args } (a name of the closed action catalogue, arguments as strings), { k: 'comment', text }, { k: 'group', name, items }, { k: 'if', branches: [{ cond, items }], else? } and { k: 'submacro', name, items }. Validated as the application validates a macro; unknown actions are refused. The base then holds active content (any macro does): BaseCraft asks to enable it when the file is opened, and the CLI never enables it.",
  },
  {
    id: 'module.create',
    label: 'Create Python module',
    params: 'name: string; code: string; description?: string',
    description: "Creates a Python module holding the source in code. The name must be a Python identifier that is not a Python keyword (letters, digits, underscore; no dot or space) and not already used by another module (case-insensitive). The source is stored as written and is NOT syntax-checked: basecraft-cli has no Python engine, and BaseCraft shows a syntax error when the module is opened. Its exported functions (public, top-level def or async def, names not starting with _) are listed from the source so that form and report events can call them as =Name(...). BaseCraft recomputes this list when the module is saved in the editor. The base then holds active content (any module does): BaseCraft asks to enable it when the file is opened, and the CLI never enables it.",
  },
  {
    id: 'resource.add',
    label: 'Add a shared image',
    params: 'file: string; name?: string',
    description: "Adds a PNG, JPEG, GIF or WebP image (at most 1 MB, checked by its signature, not its extension) from a path to the base's shared image gallery. name defaults to the file's base name without extension; a taken name becomes 'name (2)'. A form or report then draws it with { PictureType: 'shared', Picture: name }.",
  },
];
