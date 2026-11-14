// C5b: the report's Attachment control draws the first file of the row's cell (its picture, else the file-type icon).
import { describe, expect, it } from 'vitest';
import { attachmentIconSrc } from '../attachments';
import type { DesignDoc } from '../design/model';
import { defaultProps } from '../field-types';
import { layoutReport } from './layout';
import { readReport } from './model';
import { renderDocumentHtml } from './render';
import type { LayoutEnv } from './types';

const env: LayoutEnv = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } };
const fields = [{ name: 'Nom', type: 'shortText' as const, props: defaultProps('shortText') }, { name: 'Pieces', type: 'attachment' as const, props: defaultProps('attachment') }];
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'T' }, props: { Width: 8000 },
  sections: [{ kind: 'detail', height: 1200, props: {}, controls: [{ kind: 'attachment', name: 'Pieces', left: 0, top: 0, width: 1200, height: 1100, props: { ControlSource: 'Pieces' } }] }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('report Attachment control', () => {
  it('draws the picture of the first file, the icon of another file, nothing without files', async () => {
    const data = { fields, rows: [['A', 1], ['B', 1], ['C', null]], attachments: { Pieces: [{ name: 'a.png', type: 'png', src: PNG }, { name: 'b.pdf', type: 'pdf', src: null }, null] } };
    const r = await layoutReport(readReport(doc, fields), data, env);
    expect(r.issues).toEqual([]);
    const items = r.pages[0]!.bands.filter((b) => b.section === 'detail').map((b) => b.items);
    expect(items[0]).toMatchObject([{ kind: 'image', src: PNG, sizeMode: 'zoom', width: 1200, height: 1100 }]);
    expect(items[1]).toMatchObject([{ kind: 'image', src: attachmentIconSrc('b.pdf', 'pdf') }]);
    expect(items[2]).toEqual([]);
    const html = renderDocumentHtml(r);   // the PDF is this document printed
    expect(html).toContain(PNG);
    expect(html).toContain('data:image/svg+xml');
  });

  it('the icon names the file and escapes it', () => {
    const svg = decodeURIComponent(attachmentIconSrc('a<b>&"c".txt', 'txt').split(',', 2)[1]!);
    expect(svg).toContain('TXT');
    expect(svg).not.toContain('<b>');
  });
});
