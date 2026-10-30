# Access test files (C2, gate G1)

Real Access files, made by the owner in Microsoft Access 365 on Windows (region French), committed as small binaries
(`*.accdb` and `*.mdb` are `binary` in `.gitattributes`). CI never needs Access. Never regenerate them with a script: a
generated file would prove nothing about what Access itself writes.

`expected.ts` holds the values these files must give back, as Access shows them on screen (region French). Its values were
first derived from the files by BaseCraft's team; the owner confirms them on Access's screens (G1) before the manual
validation, and every `// TO CONFIRM` there is replaced by what Access shows.

## Files

- `Ventes.accdb` (Access 2007-2016 format):
  - `Clients`: `N°` AutoNumber (primary key), `Nom` Short Text 50, `Ville` Short Text 50, `Inscrit` Date/Time, `Actif` Yes/No,
    `Remarque` Long Text, `Photo` Attachment. Rows:
    1 Dupont, Lyon, 15/01/2024, Yes, "Client historique";
    2 Martin, LYON, 03/06/2024 14:30:00, Yes, empty;
    3 Durand, Paris, 30/09/2025, No, empty;
    4 Éric, Lyôn, empty, Yes, "Accent".
    A photo attached to Dupont.
  - `Commandes`: `N°` AutoNumber (primary key), `Client` Number Long Integer, `Montant` Currency, `Le` Date/Time,
    `Quantité` Number Integer, `Remise` Number Single, `Poids` Number Double, `Taux` Number Decimal (precision 10, scale 2),
    `Lot` Number Byte. Rows (Client, Montant, Le, Quantité, Remise, Poids, Taux, Lot):
    (1, 10,10, 01/10/2026, 1, 0, 1,5, 19,60, 1);
    (1, 0,10, 05/10/2026, 2, 0, 0,25, 5,50, 1);
    (2, 0,20, 21/10/2026 09:15:00, 1, 0,1, 2, 19,60, 2);
    (3, 99,99, 30/09/2026, 3, 0,25, 12,125, 20,00, 3);
    (2, 0,10, 21/10/2026, 1, 0, 0, 0,00, 255).
  - `Divers`: `Avant1900` Date/Time = 14/07/1789; `Heure` Date/Time = 08:30:00 (time only).
  - Saved query `QTotaux` (Totals): `Client` Group By, `Montant` Sum (`Total`), `N°` Count (`Nb`).
- `Ventes.mdb`: `Ventes.accdb` with `Photo` deleted, saved as Access 2002-2003 (`.mdb` cannot hold attachments).
- `Ventes-mdp.accdb`: a copy of `Ventes.accdb` encrypted with the database password `Recette-C2!`
  (File > Info > Encrypt with Password, opened exclusively, default encryption).
- `Ventes-mdp.mdb`: a copy of `Ventes.mdb` with the database password `Recette-C2!`.
- `Ventes-modifie.accdb`: a copy of `Ventes.accdb` where Durand's `Ville` is "Marseille" and a sixth order
  (3, 5,00, 27/10/2026, 1, 0, 1, 19,60, 1) is added.
- Each file Compacted and Repaired before it is committed.

## What to record from Access into `expected.ts`

As shown on screen (region French):

- the `Clients` and `Commandes` datasheets (every value, in order);
- `QTotaux`'s datasheet for `Ventes.accdb` and for `Ventes-modifie.accdb`;
- the `Clients` datasheet filtered with Text Filters > Equals "Lyon";
- `Commandes` sorted by `Montant` descending (the `N°` order);
- the Field Size of `Nom` and `Ville`.

## Differences from the recipe (as delivered, 2026-10-28)

The recipe above is what the owner followed. The delivered files differ from it in the points below. **The files, and
`expected.ts` (which follows them), are authoritative**; `expected.ts` stays a draft until the owner confirms it on Access's
screens (G1). The files are not "fixed" to match the recipe.

- Dupont's `Remarque` holds a leading space: `" Client historique"` (the recipe has none).
- `Divers.Heure` is 09:30:00, not 08:30:00.
- The `QTotaux` columns are named `SommeDeMontant` and `CompteDeN°` (Access's defaults), not `Total` and `Nb`.
- `Taux` reads as precision 18, scale 2, not precision 10 (the owner may have left the default precision, or mdb-reader
  reports it differently).
- `Ventes-mdp.accdb` has no `Photo` column (the recipe keeps it). `Ventes-modifie.accdb` has it.
- Jet 4 (`.mdb`) passwords are not enforced by mdb-reader: `Ventes-mdp.mdb` has the password `Recette-C2!` set
  (`getPassword()` returns it) but opens with no password or a wrong one, since a Jet 4 password lives in the header and
  does not encrypt the data. BaseCraft therefore compares `getPassword()` with the password supplied, and treats a mismatch
  as "password needed". Only `Ventes-mdp.accdb` is really encrypted (mdb-reader throws "Wrong password").
