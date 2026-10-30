// DRAFT. These values were derived from the five files by BaseCraft's team (read with mdb-reader, then formatted the way Access's
// datasheets show them in region French). The owner must confirm them on Access's screens (gate G1) before the manual validation;
// every value that was guessed, not read, carries a `// TO CONFIRM` comment. See README.md for the recipe.
//
// Cells are strings as the datasheet shows them, except Yes/No (boolean). An empty cell is ''.
// TO CONFIRM (all currency cells): the space before the euro sign is written as a plain space; Windows may use a no-break space.
export const ACCESS_PASSWORD = 'Recette-C2!';
export const ACCESS_EXPECTED = {
  // N°, Nom, Ville, Inscrit, Actif, Remarque (Photo, the attachment, is not a text cell)
  clients: [
    ['1', 'Dupont', 'Lyon', '15/01/2024', true, ' Client historique'], // TO CONFIRM: the file holds a leading space before "Client" (the recipe has none)
    ['2', 'Martin', 'LYON', '03/06/2024 14:30:00', true, ''],
    ['3', 'Durand', 'Paris', '30/09/2025', false, ''],
    ['4', 'Éric', 'Lyôn', '', true, 'Accent'],
  ] as (string | boolean)[][],
  // N°, Client, Montant, Le, Quantité, Remise, Poids, Taux, Lot
  commandes: [
    ['1', '1', '10,10 €', '01/10/2026', '1', '0', '1,5', '19,60', '1'], // TO CONFIRM: Taux keeps its two decimals (19,60), not General Number's 19,6
    ['2', '1', '0,10 €', '05/10/2026', '2', '0', '0,25', '5,50', '1'],
    ['3', '2', '0,20 €', '21/10/2026 09:15:00', '1', '0,1', '2', '19,60', '2'], // TO CONFIRM: Remise (Single 0.1) shows 0,1
    ['4', '3', '99,99 €', '30/09/2026', '3', '0,25', '12,125', '20,00', '3'],
    ['5', '2', '0,10 €', '21/10/2026', '1', '0', '0', '0,00', '255'],
  ] as string[][],
  // Divers: Avant1900, Heure
  divers: ['14/07/1789', '09:30:00'], // TO CONFIRM: the files hold 09:30:00 for Heure (the recipe says 08:30:00); Access's time-only display
  // QTotaux (Client, Sum of Montant, Count of N°); the files name the last two columns SommeDeMontant and CompteDeN° (the recipe: Total, Nb)
  totaux: [['1', '10,20 €', '2'], ['2', '0,30 €', '2'], ['3', '99,99 €', '1']], // TO CONFIRM: rows ascend by Client
  totauxModifie: [['1', '10,20 €', '2'], ['2', '0,30 €', '2'], ['3', '104,99 €', '2']],
  // Ventes-modifie.accdb: Durand's Ville, and the sixth order (same columns as `commandes`)
  modifie: { durandVille: 'Marseille', commande6: ['6', '3', '5,00 €', '27/10/2026', '1', '0', '1', '19,60', '1'] },
  filtreLyon: ['Dupont', 'Martin'], // TO CONFIRM: Equals "Lyon" is case-insensitive, accent-sensitive (Éric's "Lyôn" is out)
  montantDesc: [4, 1, 3, 2, 5], // N° by Montant descending; TO CONFIRM: the tie (orders 2 and 5, both 0,10 €) shows in N° order
  nomSize: 50,
  villeSize: 50,
};
