import { describe, expect, it } from 'vitest';
import { FORM_LAYOUT_RESTRICT, REPORT_LAYOUT_RESTRICT, gestureAllowed, restrictedTabs, type DesignerRestrict } from './designer-restrict';

const all: DesignerRestrict = { toolbox: true, sectionBars: true, events: true };
const none: DesignerRestrict = { toolbox: false, sectionBars: false, events: false };

describe('designer restrictions', () => {
  it('no restriction: the four property tabs', () => {
    expect(restrictedTabs(undefined)).toEqual(['format', 'data', 'event', 'other']);
    expect(restrictedTabs(none)).toEqual(['format', 'data', 'event', 'other']);
  });
  it('events restricted: no Event tab', () => {
    expect(restrictedTabs({ ...none, events: true })).toEqual(['format', 'data', 'other']);
    expect(restrictedTabs(all)).not.toContain('event');
  });
  it('no restriction: every gesture is allowed', () => {
    for (const k of ['move', 'resize', 'band', 'sectionHeight', 'place'] as const) {
      expect(gestureAllowed(undefined, k)).toBe(true);
      expect(gestureAllowed(none, k)).toBe(true);
    }
  });
  it('section bars restricted: the section resize handle is ignored', () => {
    expect(gestureAllowed({ ...none, sectionBars: true }, 'sectionHeight')).toBe(false);
    expect(gestureAllowed({ ...none, sectionBars: true }, 'place')).toBe(true);
  });
  it('toolbox restricted: no placement from a tool', () => {
    expect(gestureAllowed({ ...none, toolbox: true }, 'place')).toBe(false);
    expect(gestureAllowed({ ...none, toolbox: true }, 'sectionHeight')).toBe(true);
  });
  it('fully restricted: moving, resizing and selecting controls stay allowed', () => {
    for (const k of ['move', 'resize', 'band'] as const) expect(gestureAllowed(all, k)).toBe(true);
  });
  it('form Layout view: placement from a tool allowed, section heights and the Event tab still restricted', () => {
    expect(FORM_LAYOUT_RESTRICT).toEqual({ toolbox: false, sectionBars: true, events: true });
    expect(gestureAllowed(FORM_LAYOUT_RESTRICT, 'place')).toBe(true);
    expect(gestureAllowed(FORM_LAYOUT_RESTRICT, 'sectionHeight')).toBe(false);
    expect(restrictedTabs(FORM_LAYOUT_RESTRICT)).not.toContain('event');
  });
  it('report Layout view: toolbox back, section heights and the Event tab still restricted', () => {
    expect(REPORT_LAYOUT_RESTRICT).toEqual({ toolbox: false, sectionBars: true, events: true });
    expect(gestureAllowed(REPORT_LAYOUT_RESTRICT, 'place')).toBe(true);
    expect(gestureAllowed(REPORT_LAYOUT_RESTRICT, 'sectionHeight')).toBe(false);
  });
});
