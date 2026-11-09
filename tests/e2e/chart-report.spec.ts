// Graphique dans un état (F4, tâche 9) : l'aperçu l'affiche, deux exports PDF donnent le même dessin et sa police est embarquée,
// et le texte du PDF contient le titre du graphique.
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const table = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' })]);
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 8000 },
  sections: [{ kind: 'reportHeader', height: 3600, props: {}, controls: [
    { kind: 'chart', name: 'Graph', left: 200, top: 100, width: 7000, height: 3400, props: { HasLegend: false, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } },
  ] }],
};
const seed = () => seedBase('chart-report', async (db) => {
  createTable(db, table);
  for (const [Client, Montant] of [['Dupont', 10], ['Durand', 20], ['Dupont', 5], ['Martin', 7]] as const) await insertRow(db, table, { Client, Montant }, region);
  const ok = saveObject(db, 'report', 'EtatCmd', doc, null);
  if (!ok.ok) throw new Error(ok.reason);
});
const setEnv = (app: ElectronApplication, k: string, v: string) => app.evaluate((_e, [k, v]) => { process.env[k!] = v; }, [k, v] as const);

/** Les flux décompressés d'un PDF (Flate) : de quoi comparer deux exports sans leurs dates, et lire le texte. */
function streams(path: string): string[] {
  const raw = readFileSync(path), s = raw.toString('latin1'), out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const from = m.index! + m[0].length, to = s.indexOf('endstream', from);
    try { out.push(inflateSync(raw.subarray(from, to)).toString('latin1')); } catch { /* flux non compressé */ }
  }
  return out;
}
/** Les mots lisibles du PDF : chaque segment de texte (Tj / TJ) décodé avec le ToUnicode de chaque police (Identity-H, 2 octets) ;
 *  on ne sait pas quelle police sert quel segment, on garde tout ce que chaque table sait lire. */
function pdfWords(path: string): string {
  const all = streams(path), maps: Map<number, string>[] = [];
  const swap = (h: string) => Buffer.from(Buffer.from(h, 'hex').swap16()).toString('utf16le');
  for (const c of all) {
    if (!c.includes('begincmap')) continue;
    const map = new Map<number, string>();
    for (const b of c.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(m[1]!, 16), swap(m[2]!));
    for (const b of c.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of b[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const lo = parseInt(m[1]!, 16), hi = parseInt(m[2]!, 16), base = parseInt(m[3]!, 16);
      for (let g = lo; g <= hi; g++) map.set(g, String.fromCharCode(base + g - lo));
    }
    maps.push(map);
  }
  const out: string[] = [];
  for (const c of all) {
    if (c.includes('begincmap')) continue;
    // Skia pose chaque glyphe par un Td : on rassemble les glyphes d'une même police (entre deux Tf)
    for (const run of c.split(/\/F\d+ [\d.]+ Tf/)) {
      const hex = [...run.matchAll(/<([0-9a-f]+)>\s*Tj|\[([^\]]*)\]\s*TJ/gi)].flatMap((m) => [...(m[1] ?? m[2]!).matchAll(/[0-9a-f]{4,}/gi)].map((h) => h[0])).join('');
      for (const map of maps) out.push([...hex.matchAll(/[0-9a-f]{4}/gi)].map((g) => map.get(parseInt(g[0], 16)) ?? '').join(''));
    }
  }
  return out.join('|');
}

test('a report chart shows in the preview, exports the same PDF twice, embeds its font and prints its title', async () => {
  const out = mkdtempSync(join(tmpdir(), 'basecraft-chart-'));
  const first = join(out, 'a.pdf'), second = join(out, 'b.pdf');
  const { app, page } = await launchApp({ args: [await seed()], env: { ...FR, BASECRAFT_E2E_PDF_PATH: first } });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-EtatCmd').dblclick();
    const view = page.locator('.doc:not([hidden])');
    await expect(view.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const svg = view.locator('.bc-chart svg');
    await expect(svg).toBeVisible();
    await expect(svg).toContainText('Titre du graphique');
    await expect(svg).toContainText('Dupont');
    for (const file of [first, second]) {
      await setEnv(app, 'BASECRAFT_E2E_PDF_PATH', file);
      await page.getByTestId('cmd-exportPdf').click();
      await page.getByTestId('modal-btn-ok').click();
    }
    expect(streams(first).length).toBeGreaterThan(0);
    expect(streams(second)).toEqual(streams(first));   // la zone du graphique est la page : mêmes octets décompressés
    const pdf = readFileSync(first).toString('latin1');
    expect([...pdf.matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([A-Za-z]+)/g)].map((m) => m[1])).toContain('Inter');
    const words = pdfWords(first);
    expect(words).toContain('Titre');
    expect(words).toContain('graphique');
  } finally { await app.close(); }
});
