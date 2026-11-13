// Insert Hyperlink in a report (D3). Insert Image now goes through the shared image gallery (F3), see ImageGallery / armedTool.
import type { DesignDoc } from '../../../shared/design/model';
import { nextName, placeControls, topBelow, withSections } from './report-sections';

/** A label of 4 × 0.6 cm at the end of the Detail, Caption = the text, HyperlinkAddress = the address; printed as a link. */
export function insertHyperlink(doc: DesignDoc, link: { text: string; address: string }, prefix: string): DesignDoc {
  const d = withSections(doc, ['detail']);
  const index = d.sections.findIndex((s) => s.kind === 'detail');
  const detail = d.sections[index]!;
  return placeControls(d, index, [{ kind: 'label', name: nextName(d, prefix, []), left: 0, top: topBelow(detail), width: 2268, height: 340,
    props: { Caption: link.text, HyperlinkAddress: link.address } }]);
}
