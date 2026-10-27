// Ligne en cours de saisie, enregistrée en entier quand on la quitte (comme Access). Une seule ligne à la fois.
import type { RowWriteResult } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';

export type CommitOutcome =
  | { status: 'none' }
  | { status: 'saved'; rowid: number; values: SqlValue[] }
  | { status: 'failed'; errors: Extract<RowWriteResult, { ok: false }>['errors'] };
type Pending = { rowIndex: number; rowid: number | null; changes: Record<string, CellInput>; looked: Record<string, SqlValue> /* AutoLookup (B4 R4): shown, never written */ };

export class RowBuffer {
  private row: Pending | null = null;
  private inflight: Promise<CommitOutcome> | null = null;
  /** The pending row's AutoLookups (R4): reset with the row. */
  readonly lookups = new Lookups();

  constructor(private readonly save: (rowid: number | null, changes: Record<string, CellInput>) => Promise<RowWriteResult>) {}

  /** Every unsaved change of the row, including those of a save in flight. */
  get pending(): Omit<Pending, 'looked'> | null {
    return this.row && { rowIndex: this.row.rowIndex, rowid: this.row.rowid, changes: { ...this.row.changes } };
  }

  /** The pending row's looked-up values (lookedUp), shown where nothing was typed since. */
  get looked(): Record<string, SqlValue> {
    return { ...this.row?.looked };
  }

  edit(rowIndex: number, rowid: number | null, field: string, input: CellInput): void {
    if (this.row && this.row.rowIndex !== rowIndex) throw new Error(`row ${this.row.rowIndex} is pending: leave it before editing row ${rowIndex}`);
    // No prototype: a field may be named __proto__, constructor… (copies made by spreading keep them as own keys).
    this.row ??= { rowIndex, rowid, changes: Object.create(null) as Record<string, CellInput>, looked: Object.create(null) as Record<string, SqlValue> };
    this.row.changes[field] = input;
  }

  /** A parent's values found by AutoLookup for the pending row: shown, not pending; what was typed in those fields goes (R4),
   *  except an edit made after the lookup was asked (`sent`: the row's changes then; omitted: every edit goes). */
  lookedUp(rowIndex: number, values: Record<string, SqlValue>, sent?: Record<string, CellInput>): void {
    if (this.row?.rowIndex !== rowIndex) return;
    applyLookup(this.row.changes, this.row.looked, values, sent);
  }

  /** Saves the pending row when the selection goes to another row (null: nowhere). */
  leaveRow(nextRowIndex: number | null): Promise<CommitOutcome> {
    if (!this.row || nextRowIndex === this.row.rowIndex) return Promise.resolve({ status: 'none' });
    return this.commit();
  }

  /** One save at a time: a call made while a save is in flight gets that save's outcome (never a second insert). */
  commit(): Promise<CommitOutcome> {
    if (this.inflight) return this.inflight;
    const row = this.row;
    if (!row) return Promise.resolve({ status: 'none' });
    const sent = { ...row.changes };
    this.inflight = (async (): Promise<CommitOutcome> => {
      try {
        const r = await this.save(row.rowid, sent);
        if (!r.ok) return { status: 'failed', errors: r.errors };
        if (this.row === row) {
          // Changes typed during the save stay pending, against the row that now exists.
          for (const k of Object.keys(sent)) if (Object.is(row.changes[k], sent[k])) delete row.changes[k];
          row.rowid = r.rowid;
          if (!Object.keys(row.changes).length) this.row = null;
        }
        return { status: 'saved', rowid: r.rowid, values: r.values };
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  discard(): void {
    this.row = null;
    this.lookups.reset();
  }
}

/** AutoLookup's answer applied to a pending record (R4), the datasheet's and the form's: `values` go to `looked`, and the
 *  edits of those fields go from `changes`, except one made after the lookup was asked (`sent`: the changes then). */
export function applyLookup(changes: Record<string, CellInput>, looked: Record<string, SqlValue>, values: Record<string, SqlValue>,
  sent?: Record<string, CellInput>): void {
  for (const [k, v] of Object.entries(values)) {
    if (!sent || (Object.hasOwn(sent, k) && Object.is(sent[k], changes[k]))) delete changes[k];
    looked[k] = v;
  }
}

/** The AutoLookups of a pending record (R4), the datasheet's and the form's: one slot per link set (lookupFor's `links`), so
 *  a lookup makes only an earlier one of the same links stale, and a failure stands until those links are looked up again. */
export class Lookups {
  private latest = new Map<string, number>();
  private failed = new Map<string, unknown>();
  private inflight = new Set<Promise<void>>();
  private n = 0;

  /** Changes with every lookup asked and every reset: the same value later means none since. */
  get asked(): number { return this.n; }

  /** A failure still standing: a save refuses with it (the parent is unknown, a 'one' edit could go to the new one). */
  get failure(): { e: unknown } | null {
    for (const e of this.failed.values()) return { e };
    return null;
  }

  /** `answered` gets the answer unless a later lookup of the same links, or a reset, came since. */
  ask<T>(links: readonly string[], lookup: Promise<T>, answered: (got: T) => void): void {
    const key = links.join('\u0000'), seq = ++this.n;
    this.latest.set(key, seq);
    const p: Promise<void> = lookup.then(
      (got) => { if (this.latest.get(key) === seq) { this.failed.delete(key); answered(got); } },
      (e: unknown) => { if (this.latest.get(key) === seq) this.failed.set(key, e); },
    ).finally(() => { this.inflight.delete(p); });
    this.inflight.add(p);
  }

  /** A lookup is in flight (test it first: awaiting `settled` always yields, even with none). */
  get busy(): boolean { return this.inflight.size > 0; }

  /** Once no lookup is in flight (one asked meanwhile too): a save waits for the parents' values first. */
  async settled(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /** Another record, an undo: an answer in flight changes nothing, no failure stands. */
  reset(): void {
    this.n++;
    this.latest.clear();
    this.failed.clear();
  }
}
