import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '../../../shared/design/model';
import { defaultFor, PROPERTY_CATALOG } from '../../../shared/design/properties';
import { FACTURES_FIELDS, FACTURES_REPORT } from '../../../shared/report/fixtures/factures';
import { intersects } from '../../designer/geometry';
import { readReport } from '../../../shared/report/model';
import { headerItemControls, insertPageNumbers, reportHeaderItem, type PageNumberOptions } from './header-items';
import { blankReport } from './report-sections';

const blank = blankReport();
const footerOf = (d: DesignDoc) => d.sections.find((s) => s.kind === 'pageFooter')!;
const headerOf = (d: DesignDoc) => d.sections.find((s) => s.kind === 'pageHeader')!;
const bottom = (d: DesignDoc, i: number) => Math.max(...d.sections[i]!.controls.map((c) => c.top + c.height));

describe('report header items and page numbers', () => {
  it('title and date/time go to a report header created on demand', () => {
    const d = reportHeaderItem(reportHeaderItem(blank, 'title', { title: 'Essai' }), 'dateTime', { title: 'Essai' });
    expect(d.sections[0]!.kind).toBe('reportHeader'); expect(d.sections[0]!.controls.map((c) => c.props.ControlSource ?? c.props.Caption)).toEqual(['Essai', '=Date()', '=Time()']);
    expect(d.sections.map((s) => s.kind)).toEqual(['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter']);
    expect(d.sections[0]!.controls[0]!.props).toEqual({ Caption: 'Essai', FontSize: 18, FontWeight: 'bold' });
    expect(d.sections[0]!.controls.slice(1).map((c) => [c.props.Format, c.props.TextAlign])).toEqual([['longDate', 'right'], ['longTime', 'right']]);
    expect(d.sections[0]!.height).toBeGreaterThanOrEqual(bottom(d, 0));
    expect(readReport(d, FACTURES_FIELDS).issues).toEqual([]);
  });
  it('the logo goes on the left, the title after it', () => {
    const pic = 'data:image/png;base64,AAAA';
    const d = reportHeaderItem(reportHeaderItem(blank, 'logo', { title: 'Essai', picture: pic }), 'title', { title: 'Essai' });
    const [logo, title] = d.sections[0]!.controls;
    expect(logo).toMatchObject({ kind: 'image', left: 0, width: 851, height: 851, props: { Picture: pic } });
    expect(logo!.props.SizeMode).toBeUndefined();   // zoom is the catalog's default (C5)
    expect(title!.left).toBeGreaterThan(logo!.left + logo!.width);
  });
  it('a new report stores its Width (the catalog’s), and a report without one is as wide as its controls, as printed (M3)', () => {
    expect(blank.props.Width).toBe(defaultFor(PROPERTY_CATALOG.find((x) => x.name === 'Width')!, 'report', 'report'));
    const narrow: DesignDoc = { ...blank, props: { grouping: [] }, sections: [{ kind: 'pageHeader', height: 454, props: {}, controls: [{ kind: 'label', name: 'L', left: 0, top: 0, width: 4000, height: 340, props: {} }] }, ...blank.sections.slice(1)] };
    const d = insertPageNumbers(narrow, { format: 'pageN', position: 'bottom', align: 'right', firstPage: true, lang: 'fr' });
    expect(footerOf(d).controls[0]!.width).toBe(4000); expect(readReport(d, FACTURES_FIELDS).width).toBe(4000);
  });
  it('page numbers', () => {
    const d = insertPageNumbers(blank, { format: 'pageNofM', position: 'bottom', align: 'center', firstPage: false, lang: 'fr' });
    expect(footerOf(d).controls[0]!.props).toMatchObject({ ControlSource: '=IIf([Page]=1,Null,"Page " & [Page] & " sur " & [Pages])', TextAlign: 'center' });
    expect(readReport(d, FACTURES_FIELDS).issues).toEqual([]);
  });
  it('page numbers: format, position, language; under the controls already there', () => {
    const o: PageNumberOptions = { format: 'pageN', position: 'top', align: 'right', firstPage: true, lang: 'en' };
    const d = insertPageNumbers(blank, o);
    expect(headerOf(d).controls[0]).toMatchObject({ left: 0, width: 6994, props: { ControlSource: '="Page " & [Page]', TextAlign: 'right' } });
    expect(footerOf(insertPageNumbers(blank, { ...o, format: 'pageNofM', position: 'bottom' })).controls[0]!.props.ControlSource).toBe('="Page " & [Page] & " of " & [Pages]');
    const twice = insertPageNumbers(d, o);
    const [a, b] = headerOf(twice).controls;
    expect(b!.top).toBeGreaterThanOrEqual(a!.top + a!.height);
    expect(headerOf(twice).height).toBeGreaterThanOrEqual(b!.top + b!.height);
    expect(new Set([a!.name, b!.name]).size).toBe(2);
    // a report without its page pair gets it back
    const none = { ...blank, sections: blank.sections.filter((s) => s.kind === 'detail') };
    expect(insertPageNumbers(none, o).sections.map((s) => s.kind)).toEqual(['pageHeader', 'detail', 'pageFooter']);
  });
  it('Title and Date and Time reuse the controls already there (selected by the view) instead of stacking copies', () => {
    const t = reportHeaderItem(blank, 'title', { title: 'Essai' });
    expect(reportHeaderItem(t, 'title', { title: 'Autre' })).toBe(t);
    expect(headerItemControls(t, 'title')).toEqual(['Titre']);
    expect(reportHeaderItem(FACTURES_REPORT, 'title', { title: 'x' })).toBe(FACTURES_REPORT);   // its « Titre » label
    expect(headerItemControls(FACTURES_REPORT, 'title')).toEqual(['Titre']);
    const dt = reportHeaderItem(t, 'dateTime', { title: 'Essai' });
    expect(reportHeaderItem(dt, 'dateTime', { title: 'Essai' })).toBe(dt);
    expect(headerItemControls(dt, 'dateTime')).toEqual(['Auto_Date', 'Auto_Heure']);
    // only the date left: the time comes back, alone
    const dateOnly = { ...dt, sections: dt.sections.map((s) => ({ ...s, controls: s.controls.filter((c) => c.name !== 'Auto_Heure') })) };
    const back = reportHeaderItem(dateOnly, 'dateTime', { title: 'Essai' });
    expect(back.sections[0]!.controls.map((c) => c.name)).toEqual(['Titre', 'Auto_Date', 'Auto_Heure']);
    expect(headerItemControls(blank, 'title')).toEqual([]);
  });
  it('a logo added after the title moves the title after it', () => {
    const d = reportHeaderItem(reportHeaderItem(blank, 'title', { title: 'Essai' }), 'logo', { title: 'Essai', picture: 'data:image/png;base64,AAAA' });
    const title = d.sections[0]!.controls.find((c) => c.name === 'Titre')!, logo = d.sections[0]!.controls.find((c) => c.kind === 'image')!;
    expect(intersects(title, logo)).toBe(false);
    expect(title.left).toBe(logo.left + logo.width + 57);
  });
});
