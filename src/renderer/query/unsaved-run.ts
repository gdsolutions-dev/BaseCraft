import type { DesignDoc } from '../../shared/design/model';

// SQL d'une requête jamais enregistrée, exécutée telle quelle (Access) : posée par la conception à la sortie, lue par la feuille de données.
export const unsavedRunSql = new Map<string, string>();
// Définition d'un formulaire ou d'un état jamais enregistré (ou modifié), affiché tel quel comme une requête : posée par la conception
// à la sortie (Mode Formulaire, Aperçu avant impression), lue par la vue qui s'ouvre.
export const unsavedRunDoc = new Map<string, DesignDoc>();
