// Les concepteurs ouverts (formulaires et états) : la galerie des thèmes y retrouve les documents ouverts d'un genre, pour leur
// retirer leur thème propre par une modification de leur propre pile d'annulation (sans les réécrire dans la base).
export interface OpenDesign { kind: 'form' | 'report'; name: string; clearTheme(): void }

const open = new Set<OpenDesign>();

/** Inscrit un concepteur ouvert ; rend la fonction qui le retire (à l'arrêt de la vue ou au changement de nom). */
export function registerOpenDesign(entry: OpenDesign): () => void {
  open.add(entry);
  return () => { open.delete(entry); };
}

export const openDesigns = (kind: 'form' | 'report'): readonly OpenDesign[] => [...open].filter((d) => d.kind === kind);
