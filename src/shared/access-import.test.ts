import { describe, expect, it } from 'vitest';
import { lineKey, REPORT_LEVEL, reportText, type ReportLine } from './access-import';

const t = (k: string, p?: Record<string, unknown>) => `${k}${p ? JSON.stringify(p) : ''}`;

describe('access-import report', () => {
  it('REPORT_LEVEL gives every code a level', () => {
    expect(REPORT_LEVEL.tableImported).toBe('carried');
    expect(REPORT_LEVEL.keyAssumed).toBe('approximated');
    expect(REPORT_LEVEL.fieldSkipped).toBe('ignored');
    expect([REPORT_LEVEL.structureExact, REPORT_LEVEL.keyApproximated, REPORT_LEVEL.propertyDropped, REPORT_LEVEL.indexDropped])
      .toEqual(['carried', 'approximated', 'ignored', 'ignored']);
  });
  it('reportText: ignored first, then approximated, then carried; an empty level is left out', () => {
    const text = reportText({ source: 'Ventes.accdb', lines: [
      { code: 'tableImported', object: 'Clients', n: 4 }, { code: 'fieldSkipped', object: 'Clients', part: 'Photo' } ] }, t);
    const lines = text.split('\n');
    expect(lines[0]).toBe('import.report.title{"source":"Ventes.accdb"}');
    expect(text.indexOf('import.report.level.ignored')).toBeLessThan(text.indexOf('import.report.level.carried'));
    expect(text).not.toContain('import.report.level.approximated');
    expect(text).toContain('import.report.line.fieldSkipped{"object":"Clients","part":"Photo"}');
    expect(text.endsWith('\n')).toBe(true);
  });
  it('reportText: a structureNotRead line with an object has its own text, the one without keeps the general one', () => {
    const text = reportText({ source: 'Ventes.accdb', lines: [{ code: 'structureNotRead', object: 'Commandes' }, { code: 'structureNotRead' }] }, t);
    expect(text).toContain('import.report.line.structureNotReadTable{"object":"Commandes"}\n');
    expect(text).toContain('import.report.line.structureNotRead{}\n');
  });
  it('reportText: an indexDropped line without an index name has its own text', () => {
    const text = reportText({ source: 'Ventes.accdb', lines: [{ code: 'indexDropped', object: 'Commandes' }, { code: 'indexDropped', object: 'Commandes', part: 'I1' }] }, t);
    expect(text).toContain('import.report.line.indexDroppedTable{"object":"Commandes"}\n');
    expect(text).toContain('import.report.line.indexDropped{"object":"Commandes","part":"I1"}\n');
  });
  it('the query codes have their levels and texts', () => {
    expect([REPORT_LEVEL.queryImported, REPORT_LEVEL.queryKeptAsText, REPORT_LEVEL.querySourceMissing, REPORT_LEVEL.queryPassThrough, REPORT_LEVEL.querySkipped, REPORT_LEVEL.formsOnly])
      .toEqual(['carried', 'approximated', 'approximated', 'approximated', 'ignored', 'ignored']);
    const lines: ReportLine[] = [{ code: 'queryImported', object: 'Q' }, { code: 'queryImported', object: 'Q1', part: 'Q' }, { code: 'queryKeptAsText', object: 'Q', reason: 'notRead' },
      { code: 'querySourceMissing', object: 'Q', part: 'T' }, { code: 'queryPassThrough', object: 'Q', part: 'ODBC' }, { code: 'queryPassThrough', object: 'Q' },
      { code: 'querySkipped', object: 'Q', reason: 'duplicate' }, { code: 'formsOnly' }];
    const text = reportText({ source: 'Ventes.accdb', lines }, t);
    for (const k of ['queryImported{"object":"Q"}', 'queryImportedAs{"object":"Q1","part":"Q"}', 'queryKeptAsText{"object":"Q","reason":"notRead"}', 'querySourceMissing{"object":"Q","part":"T"}',
      'queryPassThrough{"object":"Q","part":"ODBC"}', 'queryPassThroughPlain{"object":"Q"}', 'querySkipped{"object":"Q","reason":"duplicate"}', 'formsOnly{}']) {
      expect(text).toContain(`import.report.line.${k}\n`);
    }
    expect(['otherSource', 'sameFile'].map((reason) => lineKey({ code: 'tableLinked', object: 'T', reason }))).toEqual(['tableLinked_otherSource', 'tableLinked_sameFile']);
    expect(lineKey({ code: 'tableLinked', object: 'T' })).toBe('tableLinked');
    expect(lines.map(lineKey)).toEqual(['queryImported', 'queryImportedAs', 'queryKeptAsText', 'querySourceMissing', 'queryPassThrough', 'queryPassThroughPlain', 'querySkipped', 'formsOnly']);
  });
  it('the lines of an embedded macro have their own sentences', () => {
    const e = (code: string) => lineKey({ code, object: 'F', part: 'B.OnClick', reason: 'embedded' } as ReportLine);
    expect(['macroElseLost', 'macroNotConverted', 'macroActionComment', 'macroConditionKept', 'macroArgumentDropped'].map(e))
      .toEqual(['macroElseLostIn', 'macroNotConvertedIn', 'macroActionCommentIn', 'macroConditionKeptIn', 'macroArgumentDroppedIn']);
    expect(['macroElseLost', 'macroNotConverted', 'macroActionComment', 'macroConditionKept', 'macroArgumentDropped'].map((code) => lineKey({ code, object: 'M', part: code === 'macroElseLost' || code === 'macroNotConverted' ? undefined : 'X' } as ReportLine)))
      .toEqual(['macroElseLost', 'macroNotConverted', 'macroActionComment', 'macroConditionKept', 'macroArgumentDropped']);
  });
  it('the design codes have their levels and their keys', () => {
    expect([REPORT_LEVEL.formImported, REPORT_LEVEL.reportImported, REPORT_LEVEL.designSkipped, REPORT_LEVEL.designPropertiesIgnored, REPORT_LEVEL.designControlReplaced, REPORT_LEVEL.designEventDropped,
      REPORT_LEVEL.designExpressionKept, REPORT_LEVEL.designSectionDropped, REPORT_LEVEL.designControlRenamed, REPORT_LEVEL.designPageDefault, REPORT_LEVEL.designSourceMissing, REPORT_LEVEL.designSubformTable, REPORT_LEVEL.macrosOnly])
      .toEqual(['carried', 'carried', 'ignored', 'ignored', 'approximated', 'ignored', 'approximated', 'ignored', 'approximated', 'approximated', 'approximated', 'approximated', 'ignored']);
    const lines: ReportLine[] = [{ code: 'formImported', object: 'F' }, { code: 'formImported', object: 'F1', part: 'F' }, { code: 'reportImported', object: 'E' }, { code: 'reportImported', object: 'E1', part: 'E' },
      { code: 'designEventDropped', object: 'F', part: 'OnClick', reason: 'procedure' }, { code: 'designEventDropped', object: 'F', part: 'OnOpen', reason: 'expression' }, { code: 'designEventDropped', object: 'F', part: 'OnLoad', reason: 'embeddedMacro' },
      { code: 'designSourceMissing', object: 'F', part: 'T' }, { code: 'designSourceMissing', object: 'F' }, { code: 'macrosOnly' }];
    expect(lines.map(lineKey)).toEqual(['formImported', 'formImportedAs', 'reportImported', 'reportImportedAs', 'designEventDropped_procedure', 'designEventDropped_expression', 'designEventDropped_embeddedMacro',
      'designSourceMissing', 'designSourceNotRead', 'macrosOnly']);
  });
});
