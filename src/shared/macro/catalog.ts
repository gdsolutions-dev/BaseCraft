// The closed catalogue of macro actions of stage B1 (spec 4.8). Pure module. Names, argument names and enum values are the
// invariant ones that a definition stores; the labels come from `macro.action.<Name>`, `macro.arg.<Arg>`,
// `macro.argValue.<Arg>.<value>` (an empty value uses the suffix `empty`) and `macro.category.<cat>`.
// B2 appends the form actions.

export type ActionName = 'Beep' | 'ClearMacroError' | 'CloseDatabase' | 'CloseWindow' | 'MessageBox' | 'OnError' | 'OpenForm' | 'OpenQuery'
  | 'OpenReport' | 'OpenTable' | 'Quit' | 'RemoveAllTempVars' | 'RemoveTempVar' | 'RunMacro' | 'RunSQL' | 'SetLocalVar' | 'SetTempVar'
  | 'SetWarnings' | 'StopAllMacros' | 'StopMacro';
/** Access's categories that B1 fills. */
export type ActionCategory = 'ui' | 'macro' | 'system' | 'filter' | 'window' | 'objects';
/** `text`: a literal, or `=` + a canonical expression evaluated at run time, as Access; `number`: the same with a number. */
export type ArgType = 'text' | 'expression' | 'where' | 'number' | 'enum' | 'sql' | 'formName' | 'reportName' | 'queryName' | 'tableName'
  | 'macroName' | 'objectType' | 'objectName';
export interface ArgDef { name: string; type: ArgType; options?: readonly string[]; default?: string; required?: boolean }
export interface ActionDef { name: ActionName; category: ActionCategory; unsafe: boolean; args: readonly ArgDef[] }

const arg = (name: string, type: ArgType, more: Partial<ArgDef> = {}): ArgDef => ({ name, type, ...more });
const required = { required: true };
const yesNo = ['yes', 'no'] as const;
const view = (options: readonly string[]): ArgDef => arg('View', 'enum', { options, default: options[0] });
const act = (name: ActionName, category: ActionCategory, args: readonly ArgDef[] = [], unsafe = false): ActionDef => ({ name, category, unsafe, args });

export const ACTIONS: readonly ActionDef[] = [
  act('Beep', 'system'),
  act('ClearMacroError', 'macro'),
  act('CloseDatabase', 'system'),
  act('CloseWindow', 'window', [
    arg('ObjectType', 'objectType', { options: ['', 'table', 'query', 'form', 'report', 'macro'], default: '' }),
    arg('ObjectName', 'objectName')]),
  act('MessageBox', 'ui', [
    arg('Message', 'text', required),
    arg('Beep', 'enum', { options: yesNo, default: 'yes' }),
    arg('Type', 'enum', { options: ['none', 'critical', 'warning', 'question', 'information'], default: 'none' }),
    arg('Title', 'text')]),
  act('OnError', 'macro', [arg('GoTo', 'enum', { options: ['next', 'macroName', 'fail'], default: 'next' }), arg('MacroName', 'text')]),
  act('OpenForm', 'objects', [
    arg('FormName', 'formName', required),
    view(['form', 'datasheet', 'design']),
    arg('WhereCondition', 'where'),
    arg('DataMode', 'enum', { options: ['', 'add', 'edit', 'readOnly'], default: '' })]),
  act('OpenQuery', 'filter', [arg('QueryName', 'queryName', required), view(['datasheet', 'design'])]),
  act('OpenReport', 'objects', [arg('ReportName', 'reportName', required), view(['preview', 'print', 'design']), arg('WhereCondition', 'where')]),   // R7
  act('OpenTable', 'objects', [arg('TableName', 'tableName', required), view(['datasheet', 'design'])]),
  act('Quit', 'system'),   // R6
  act('RemoveAllTempVars', 'macro'),
  act('RemoveTempVar', 'macro', [arg('Name', 'text', required)]),
  act('RunMacro', 'macro', [arg('MacroName', 'macroName', required), arg('RepeatCount', 'number'), arg('RepeatExpression', 'expression')]),
  act('RunSQL', 'filter', [arg('SQLStatement', 'sql', required)], true),
  act('SetLocalVar', 'macro', [arg('Name', 'text', required), arg('Expression', 'expression', required)]),
  act('SetTempVar', 'macro', [arg('Name', 'text', required), arg('Expression', 'expression', required)]),
  act('SetWarnings', 'system', [arg('WarningsOn', 'enum', { options: yesNo, default: 'no' })], true),
  act('StopAllMacros', 'macro'),
  act('StopMacro', 'macro'),
];

const byName = new Map<string, ActionDef>(ACTIONS.map((a) => [a.name, a]));
/** The definition of an action by its invariant name (case-sensitive: a stored name is exact); undefined for an unknown one. */
export const actionDef = (name: string): ActionDef | undefined => byName.get(name);
