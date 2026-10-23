import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP } from '../../shared/report/model';
import { blankReport } from './design/report-sections';
import { MARGIN_PRESETS, marginPreset, orientationStates, withPageSetup } from './page-setup';

describe('page setup (ribbon Page Size / Page Layout)', () => {
  it('margin presets', () => {
    expect(marginPreset({ orientation: 'portrait', margins: MARGIN_PRESETS.narrow })).toBe('narrow');
    expect(marginPreset({ orientation: 'landscape', margins: { ...MARGIN_PRESETS.wide } })).toBe('wide');
    expect(marginPreset(DEFAULT_PAGE_SETUP)).toBeNull();
  });
  it('withPageSetup keeps the other fields', () => expect(withPageSetup(blankReport(), { orientation: 'landscape' }).props.pageSetup)
    .toEqual({ orientation: 'landscape', margins: DEFAULT_PAGE_SETUP.margins }));
  it('withPageSetup gives the same document back when nothing changes (no undo step, not dirty)', () => {
    const d = withPageSetup(blankReport(), { margins: MARGIN_PRESETS.normal });
    expect(withPageSetup(d, { margins: { ...MARGIN_PRESETS.normal } })).toBe(d);
    const b = blankReport();   // nothing stored: the defaults are not written either
    expect(withPageSetup(b, { orientation: 'portrait' })).toBe(b);
  });
  it('Portrait and Landscape: the orientation shown pressed (registerCommandStates)', () => {
    expect(orientationStates('portrait')).toEqual({ portrait: { active: true }, landscape: { active: false } });
    expect(orientationStates('landscape')).toEqual({ portrait: { active: false }, landscape: { active: true } });
  });
});
