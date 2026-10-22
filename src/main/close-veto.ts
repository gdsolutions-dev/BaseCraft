// Fermeture de la fenêtre soumise au rendu (R24), sans rester bloqué par un rendu figé (R26).

/** A close request the renderer has not acknowledged for this long means it is hung: the window closes without it. */
export const HUNG_MS = 5000;

export class CloseVeto {
  private askedAt: number | null = null;
  constructor(private readonly now: () => number = Date.now) {}

  /** On each 'close' of the window: 'ask' (send the request to the renderer), 'wait' (one is out, recently), or 'close'
   *  (the request sent ≥ HUNG_MS ago was never acknowledged). */
  request(): 'ask' | 'wait' | 'close' {
    if (this.askedAt === null) { this.askedAt = this.now(); return 'ask'; }
    return this.now() - this.askedAt >= HUNG_MS ? 'close' : 'wait';
  }

  /** The renderer received the request (its documents are now asked): a later close asks again. */
  acknowledged(): void { this.askedAt = null; }
}
