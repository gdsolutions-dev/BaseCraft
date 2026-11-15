// E6c: the print-only block of `print` (RunMenuCommand): the Detail once per record, in normal flow, between the header and the footer. Never
// displayed on screen (form.css); only while a print-all runs. The current record uses the live context (its uncommitted values print as shown),
// the others their row's, with ids of their own.
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import type { RunCtx } from './controls/run-ctx';
import { FormSection } from './FormSection';

export function PrintAllRows({ doc, detail, rows, x, rowCtx, width }: { doc: DesignDoc; detail: SectionDef | undefined; rows: number[] | null | undefined; x: RunCtx; rowCtx: (i: number) => RunCtx; width: number }) {
  if (!rows || !detail) return null;
  return (
    <div className="frun-printall" aria-hidden data-testid="form-print-all">
      {rows.map((i) => (
        <div key={i} className="frun-detail frun-print-row" data-testid={`form-print-${i}`} data-row-other="">
          <FormSection doc={doc} section={detail} x={{ ...(i === x.snap.index && !x.snap.isNew ? { ...x, id: rowCtx(i).id } : rowCtx(i)), print: true }} width={width} />
        </div>
      ))}
    </div>
  );
}
