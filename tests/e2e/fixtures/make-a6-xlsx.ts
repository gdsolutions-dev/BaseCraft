// Classeur de test du lot A6, construit avec exceljs (le binaire n'est pas versionné).
import ExcelJS from 'exceljs';

/** Clients : en-tête ligne 1, fusion ligne 3, ligne 4 vide, `#DIV/0!` ligne 5. Vide : en-tête seul. Produits : 2 lignes. */
export async function makeA6Xlsx(path: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const c = wb.addWorksheet('Clients');
  const day = new Date(Date.UTC(2026, 9, 23));
  const time = new Date(Date.UTC(2026, 9, 23, 9, 5));
  c.addRow(['Nom', 'CodePostal', 'Montant', 'Date', 'Heure']);
  c.addRow(['Dupont', '01000', 12.5, day, time]);
  c.addRow(['Fusion', '', 7, day, time]);
  c.mergeCells('A3:B3');
  c.addRow([]);
  c.addRow(['Martin', '75001', { error: '#DIV/0!' }, day, time]);
  c.addRow(['Durand', '69001', { formula: 'C2*2', result: 25 }, day, time]);
  c.addRow(['Petit', '33000', 3, day, time]);
  wb.addWorksheet('Vide').addRow(['Nom', 'Montant']);
  const p = wb.addWorksheet('Produits');
  p.addRow(['Nom', 'Montant']);
  p.addRow(['Stylo', 1.5]);
  p.addRow(['Cahier', 4]);
  await wb.xlsx.writeFile(path);
}
