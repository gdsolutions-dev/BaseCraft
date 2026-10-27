import { expect, it } from 'vitest';
import { toSerial } from '../expr/library';
import { localeInfo } from '../locale-format';
import type { CrosstabQuery } from './ast';
import { crosstabSelect, headingName, inHeadings, pivotValuesQuery } from './crosstab';
import { printSelect } from './print';
import { parseSql } from './sql-parser';

const QX = 'TRANSFORM Sum(Commandes.Montant) SELECT Clients.Nom, Sum(Commandes.Montant) AS Total FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Clients.Nom PIVOT Month(Commandes.Le)';
const ct = (sql: string) => parseSql(sql).body as CrosstabQuery;
const fr = localeInfo('fr-FR');

it('crosstabSelect: one column per heading, ordered by the row headings', () => {
  const sql = printSelect(crosstabSelect(ct(QX), [{ name: '9', value: { k: 'num', v: '9' } }]));
  expect(sql).toMatch(/^SELECT \[Clients\]\.\[Nom\], Sum\(\[Commandes\]\.\[Montant\]\) AS \[Total\], Sum\(IIf\(Month\(\[Commandes\]\.\[Le\]\) = 9, \[Commandes\]\.\[Montant\], Null\)\) AS \[9\]\n/);
  expect(sql).toMatch(/\nORDER BY \[Clients\]\.\[Nom\]$/);
});

it('crosstabSelect: Count is Null over no row, the Null heading matches Is Null, ORDER BY kept', () => {
  const q = ct('TRANSFORM Count(*) + Count(Montant) SELECT Client FROM Commandes GROUP BY Client ORDER BY Client DESC PIVOT Le');
  expect(printSelect(crosstabSelect(q, [{ name: '<>', value: { k: 'null' } }]))).toBe([
    'SELECT [Client], IIf(Count(IIf([Le] Is Null, 1, Null)) = 0, Null, Count(IIf([Le] Is Null, 1, Null)))'
      + ' + IIf(Count(IIf([Le] Is Null, 1, Null)) = 0, Null, Count(IIf([Le] Is Null, [Montant], Null))) AS [<>]',
    'FROM [Commandes]', 'GROUP BY [Client]', 'ORDER BY [Client] DESC'].join('\n'));
});

it('pivotValuesQuery: the distinct pivot values of WHERE, HAVING and ORDER BY dropped', () => {
  const q = ct('TRANSFORM Sum(Montant) SELECT Client FROM Commandes WHERE Montant > 1 GROUP BY Client HAVING Count(*) > 1 ORDER BY Client PIVOT Month(Le)');
  expect(printSelect(pivotValuesQuery(q))).toBe('SELECT Month([Le])\nFROM [Commandes]\nWHERE [Montant] > 1\nGROUP BY Month([Le])\nORDER BY Month([Le])');
});

it('headingName (R9)', () => {
  expect(headingName(null, fr)).toBe('<>');
  expect(headingName({ t: 'str', v: '' }, fr)).toBe('""');
  expect(headingName({ t: 'date', v: toSerial('2026-10-01 00:00:00') }, fr)).toBe('01/10/2026');
  expect(headingName({ t: 'num', v: 1.5 }, fr)).toBe('1,5');
});

it('inHeadings: signed numbers, -0 as 0, names in the region', () => {
  const hs = inHeadings(ct('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Le IN (-1.5, -0, "a", #2026-10-01#, Null)'), fr);
  expect(hs.map((h) => h.name)).toEqual(['-1,5', '0', 'a', '01/10/2026', '<>']);
  expect(hs.map((h) => h.value)).toEqual([{ k: 'un', op: '-', e: { k: 'num', v: '1.5' } }, { k: 'num', v: '0' }, { k: 'str', v: 'a' },
    { k: 'date', v: '2026-10-01 00:00:00' }, { k: 'null' }]);
});
