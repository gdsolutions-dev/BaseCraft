/** Suppr au niveau fenêtre : seulement hors de tout widget (body) ou depuis un bouton du ruban (Sélectionner la ligne…).
 *  Jamais depuis un <select>, une case, un onglet de feuille ou un bouton de la Liste des champs : ils gardent leur Suppr. */
export const deleteKeyAllowed = (el: Pick<Element, 'tagName' | 'closest'>): boolean =>
  el.tagName === 'BODY' || (el.tagName === 'BUTTON' && !!el.closest('.ribbon'));
