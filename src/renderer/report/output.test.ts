// Impression et export depuis le volet (revue finale M8) : Annuler dans la boîte de progression n'ouvre jamais la boîte
// Enregistrer ni l'impression, même quand la mise en page finit après l'annulation.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaidOutReport } from '../../shared/report/types';
import type { ModalApi } from '../shell/Modal';

const reports = { exportPdf: vi.fn(async () => 'canceled' as const), print: vi.fn(async () => 'canceled' as const) };
vi.mock('../bridge', () => ({ api: { reports } }));
const { outputReport } = await import('./ReportPreviewView');

const laid: LaidOutReport = { width: 11906, height: 16838, pages: [{ number: 1, bands: [] }], issues: [] };
/** The progress box answered at once: `answer` as Cancel/Escape (null) would. */
const modal = (answer: unknown): ModalApi => ({ custom: async () => answer, confirm: vi.fn(async () => 'ok'), prompt: async () => null }) as unknown as ModalApi;

describe('outputReport from the pane', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['pdf', 'printer'] as const)('Cancel during the layout: no %s dialog, even when the layout ends after it', async (to) => {
    let finish!: (r: LaidOutReport) => void;
    const m = modal(null);
    const done = outputReport(m, 'Factures', (_, ready) => { ready(); return new Promise<LaidOutReport>((r) => { finish = r; }); }, to);
    await new Promise((r) => setTimeout(r));   // the box is answered (Cancel) …
    finish(laid);                              // … then the layout, which ignored the signal, ends
    await done;
    expect(reports.exportPdf).not.toHaveBeenCalled(); expect(reports.print).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled();
  });
  it('the box waits for `ready`: a parameter prompt (C3) comes first, Cancel there ends it all without a message', async () => {
    const m = modal('done');
    const custom = vi.spyOn(m, 'custom');
    await outputReport(m, 'Factures', async () => { throw Object.assign(new Error('canceled'), { name: 'AbortError' }); }, 'pdf');
    expect(custom).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled(); expect(reports.exportPdf).not.toHaveBeenCalled();
  });
  it('a layout that ends closes the box itself, and the output goes on', async () => {
    await outputReport(modal('done'), 'Factures', async () => laid, 'pdf');
    expect(reports.exportPdf).toHaveBeenCalledTimes(1);
  });
});
