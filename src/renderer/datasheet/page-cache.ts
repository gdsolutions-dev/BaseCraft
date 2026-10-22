// Lignes lues par pages, à la demande de la grille. Après invalidate, les anciennes lignes restent affichées
// jusqu'à l'arrivée des nouvelles (pas de clignotement) ; une nouvelle structure de table demande un nouveau cache.
import type { RowPage } from '../../shared/api';

type Row = RowPage['rows'][number];

export class PageCache {
  private pages = new Map<number, Row[]>();
  private stale = new Map<number, Row[]>(); // shown while a page is (re)loaded
  private loading = new Map<number, number>(); // page → request number; a failed page stays here until invalidate
  private reread = new Set<number>(); // written while loading: the reply may predate the write
  private requests = 0;
  private loaded: (() => void)[] = [];
  private failed: ((e: unknown) => void)[] = [];

  constructor(private readonly fetch: (offset: number, limit: number) => Promise<RowPage>, private readonly pageSize = 200) {}

  /** The row, or undefined while its page loads (the load starts here). */
  get(rowIndex: number): Row | undefined {
    const p = Math.floor(rowIndex / this.pageSize);
    const i = rowIndex % this.pageSize;
    const page = this.pages.get(p);
    if (page) return page[i];
    if (!this.loading.has(p)) this.load(p);
    return this.stale.get(p)?.[i];
  }

  /** False while the row comes from before an invalidate (sort, delete): its index may now hold another record. */
  fresh(rowIndex: number): boolean {
    return this.pages.has(Math.floor(rowIndex / this.pageSize));
  }

  /** A row just written: shown at once, without reloading its page. */
  set(rowIndex: number, row: Row): void {
    const p = Math.floor(rowIndex / this.pageSize);
    let page = this.pages.get(p) ?? this.stale.get(p);
    if (!page) this.stale.set(p, (page = []));
    page[rowIndex % this.pageSize] = row;
    if (this.loading.has(p)) this.reread.add(p);
  }

  onLoaded(cb: () => void): void { this.loaded.push(cb); }
  onError(cb: (e: unknown) => void): void { this.failed.push(cb); }

  invalidate(): void {
    for (const [p, rows] of this.pages) this.stale.set(p, rows);
    this.pages.clear();
    this.loading.clear(); // replies to earlier requests are dropped
    this.reread.clear();
  }

  private load(p: number): void {
    const id = ++this.requests;
    this.loading.set(p, id);
    this.fetch(p * this.pageSize, this.pageSize).then(
      (r) => {
        if (this.loading.get(p) !== id) return;
        this.loading.delete(p);
        if (this.reread.delete(p)) { this.load(p); return; }
        this.pages.set(p, r.rows);
        this.stale.delete(p);
        this.loaded.forEach((cb) => cb());
      },
      (e) => { if (this.loading.get(p) === id) this.failed.forEach((cb) => cb(e)); },
    );
  }
}
