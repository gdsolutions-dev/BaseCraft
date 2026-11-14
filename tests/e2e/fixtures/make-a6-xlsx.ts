// Classeur de test du lot A6, construit avec le writer de tests (le binaire n'est pas versionné).
import { writeXlsx } from './xlsx-fixture';

/** Clients : en-tête ligne 1, fusion ligne 3, ligne 4 vide, `#DIV/0!` ligne 5. Vide : en-tête seul. Produits : 2 lignes. */
export async function makeA6Xlsx(path: string): Promise<void> {
  const day = new Date(Date.UTC(2026, 9, 23));
  const time = new Date(Date.UTC(2026, 9, 23, 9, 5));
  await writeXlsx(path, [
    {
      name: 'Clients', merges: ['A3:B3'], rows: [
        ['Nom', 'CodePostal', 'Montant', 'Date', 'Heure'],
        ['Dupont', '01000', 12.5, day, time],
        ['Fusion', '', 7, day, time],
        [],
        ['Martin', '75001', { error: '#DIV/0!' }, day, time],
        ['Durand', '69001', { formula: 'C2*2', result: 25 }, day, time],
        ['Petit', '33000', 3, day, time],
      ],
    },
    { name: 'Vide', rows: [['Nom', 'Montant']] },
    { name: 'Produits', rows: [['Nom', 'Montant'], ['Stylo', 1.5], ['Cahier', 4]] },
  ]);
}
