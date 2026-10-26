// The closed catalogue of macro actions of stages B1 and B2 (spec 4.8). Pure module. Names, argument names and enum values are the
// invariant ones that a definition stores; the labels come from `macro.action.<Name>`, `macro.arg.<Arg>`,
// `macro.argValue.<Arg>.<value>` (an empty value uses the suffix `empty`) and `macro.category.<cat>`.
// B2 appended the 13 form actions (R4), the `dataEntry` category and the `reference` argument type.

export type ActionName = 'Beep' | 'ClearMacroError' | 'CloseDatabase' | 'CloseWindow' | 'MessageBox' | 'OnError' | 'OpenForm' | 'OpenQuery'
  | 'OpenReport' | 'OpenTable' | 'Quit' | 'RemoveAllTempVars' | 'RemoveTempVar' | 'RunMacro' | 'RunSQL' | 'SetLocalVar' | 'SetTempVar'
  | 'SetWarnings' | 'StopAllMacros' | 'StopMacro'
  | 'ApplyFilter'
  | 'CancelEvent'
  | 'DeleteRecord'
  | 'FindRecord'
  | 'GoToControl'
  | 'GoToRecord'
  | 'RefreshRecord'
  | 'Requery'
  | 'SaveRecord'
  | 'SetProperty'
  | 'SetValue'
  | 'ShowAllRecords'
  | 'UndoRecord';
/** Access's categories that B1 and B2 fill. */
export type ActionCategory = 'ui' | 'macro' | 'system' | 'filter' | 'window' | 'objects'
  | 'dataEntry';
/** `text`: a literal, or `=` + a canonical expression evaluated at run time, as Access; `number`: the same with a number;
 *  `reference`: a canonical expression naming a control or field (SetValue's Item), edited as an expression, never evaluated by the engine. */
export type ArgType = 'text' | 'expression' | 'where' | 'number' | 'enum' | 'sql' | 'formName' | 'reportName' | 'queryName' | 'tableName'
  | 'macroName' | 'objectType' | 'objectName'
  | 'reference';
export interface ArgDef { name: string; type: ArgType; options?: readonly string[]; default?: string; required?: boolean }
export interface ActionDef { name: ActionName; category: ActionCategory; unsafe: boolean; args: readonly ArgDef[] }

const arg = (name: string, type: ArgType, more: Partial<ArgDef> = {}): ArgDef => ({ name, type, ...more });
const required = { required: true };
const yesNo = ['yes', 'no'] as const;
const yesNoArg = (name: string, def: 'yes' | 'no'): ArgDef => arg(name, 'enum', { options: yesNo, default: def });
const view = (options: readonly string[]): ArgDef => arg('View', 'enum', { options, default: options[0] });
const act = (name: ActionName, category: ActionCategory, args: readonly ArgDef[] = [], unsafe = false): ActionDef => ({ name, category, unsafe, args });

export const ACTIONS: readonly ActionDef[] = [
  act('ApplyFilter', 'filter', [arg('WhereCondition', 'where', required)]),   // R4: no FilterName / ControlName
  act('Beep', 'system'),
  act('CancelEvent', 'macro'),
  act('ClearMacroError', 'macro'),
  act('CloseDatabase', 'system'),
  act('CloseWindow', 'window', [
    arg('ObjectType', 'objectType', { options: ['', 'table', 'query', 'form', 'report', 'macro'], default: '' }),
    arg('ObjectName', 'objectName')]),
  act('DeleteRecord', 'dataEntry'),
  act('FindRecord', 'filter', [   // R4: no SearchAsFormatted
    arg('FindWhat', 'text', required),
    arg('Match', 'enum', { options: ['anywhere', 'whole', 'start'], default: 'whole' }),
    yesNoArg('MatchCase', 'no'),
    arg('Search', 'enum', { options: ['up', 'down', 'all'], default: 'all' }),
    yesNoArg('OnlyCurrentField', 'yes'),
    yesNoArg('FindFirst', 'yes')]),
  act('GoToControl', 'objects', [arg('ControlName', 'text', required)]),
  act('GoToRecord', 'objects', [   // R4: the active form (''), or a form; no table or query datasheets yet
    arg('ObjectType', 'objectType', { options: ['', 'form'], default: '' }),
    arg('ObjectName', 'objectName'),
    arg('Record', 'enum', { options: ['previous', 'next', 'first', 'last', 'goTo', 'new'], default: 'next' }),
    arg('Offset', 'number')]),
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
    arg('DataMode', 'enum', { options: ['', 'add', 'edit', 'readOnly'], default: '' }),
    arg('WindowMode', 'enum', { options: ['normal', 'dialog'], default: 'normal' })]),   // R4, R12
  act('OpenQuery', 'filter', [arg('QueryName', 'queryName', required), view(['datasheet', 'design'])]),
  act('OpenReport', 'objects', [arg('ReportName', 'reportName', required), view(['preview', 'print', 'design']), arg('WhereCondition', 'where')]),   // R7
  act('OpenTable', 'objects', [arg('TableName', 'tableName', required), view(['datasheet', 'design'])]),
  act('Quit', 'system'),   // R6
  act('RefreshRecord', 'filter'),
  act('RemoveAllTempVars', 'macro'),
  act('RemoveTempVar', 'macro', [arg('Name', 'text', required)]),
  act('Requery', 'filter', [arg('ControlName', 'text')]),
  act('RunMacro', 'macro', [arg('MacroName', 'macroName', required), arg('RepeatCount', 'number'), arg('RepeatExpression', 'expression')]),
  act('RunSQL', 'filter', [arg('SQLStatement', 'sql', required)], true),
  act('SaveRecord', 'dataEntry'),
  act('SetLocalVar', 'macro', [arg('Name', 'text', required), arg('Expression', 'expression', required)]),
  act('SetProperty', 'objects', [   // R9
    arg('ControlName', 'text'),
    arg('Property', 'enum', { options: ['enabled', 'visible', 'locked', 'left', 'top', 'width', 'height', 'foreColor', 'backColor', 'caption', 'value'], default: 'enabled' }),
    arg('Value', 'text')]),
  act('SetTempVar', 'macro', [arg('Name', 'text', required), arg('Expression', 'expression', required)]),
  act('SetValue', 'objects', [arg('Item', 'reference', required), arg('Expression', 'expression', required)], true),   // R5: unsafe, as Access
  act('SetWarnings', 'system', [arg('WarningsOn', 'enum', { options: yesNo, default: 'no' })], true),
  act('ShowAllRecords', 'filter'),
  act('StopAllMacros', 'macro'),
  act('StopMacro', 'macro'),
  act('UndoRecord', 'ui'),
];

const byName = new Map<string, ActionDef>(ACTIONS.map((a) => [a.name, a]));
/** The definition of an action by its invariant name (case-sensitive: a stored name is exact); undefined for an unknown one. */
export const actionDef = (name: string): ActionDef | undefined => byName.get(name);
