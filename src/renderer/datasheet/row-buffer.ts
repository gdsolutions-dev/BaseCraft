// Ligne en cours de saisie, enregistrée en entier quand on la quitte (comme Access). Une seule ligne à la fois.
import type { RowWriteResult } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';

export type CommitOutcome =
  | { status: 'none' }
  | { status: 'saved'; rowid: number; values: SqlValue[] }
  | { status: 'failed'; errors: Extract<RowWriteResult, { ok: false }>['errors'] };
type Pending = { rowIndex: number; rowid: number | null; changes: Record<string, CellInput> };

export class RowBuffer {
  private row: Pending | null = null;
  private inflight: Promise<CommitOutcome> | null = null;

  constructor(private readonly save: (rowid: number | null, changes: Record<string, CellInput>) => Promise<RowWriteResult>) {}

  /** Every unsaved change of the row, including those of a save in flight. */
  get pending(): Pending | null {
    return this.row && { ...this.row, changes: { ...this.row.changes } };
  }

  edit(rowIndex: number, rowid: number | null, field: string, input: CellInput): void {
    if (this.row && this.row.rowIndex !== rowIndex) throw new Error(`row ${this.row.rowIndex} is pending: leave it before editing row ${rowIndex}`);
    // No prototype: a field may be named __proto__, constructor… (copies made by spreading keep them as own keys).
    this.row ??= { rowIndex, rowid, changes: Object.create(null) as Record<string, CellInput> };
    this.row.changes[field] = input;
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
  }
}
