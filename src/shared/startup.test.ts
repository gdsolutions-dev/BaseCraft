import { describe, expect, it } from 'vitest';
import { cleanTitle, DEFAULT_STARTUP, hasStartup, MAX_ICON_BASE64, readStartup, startupHides } from './startup';

// A valid 1 x 1 PNG.
const PNG_1PX_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

describe('startup options', () => {
  it('defaults show everything', () => {
    expect(readStartup(undefined)).toEqual({ appTitle: '', appIcon: '', startupForm: '', showNavPane: true, ribbon: 'full', runMode: false });
    expect(startupHides(DEFAULT_STARTUP)).toBe(false);
    expect(hasStartup(DEFAULT_STARTUP, false)).toBe(false);
    expect(hasStartup(DEFAULT_STARTUP, true)).toBe(true);
  });

  it('each option that hides something makes the base bypassable', () => {
    for (const o of [{ startupForm: 'FMenu' }, { showNavPane: false }, { ribbon: 'simplified' as const }, { runMode: true }]) {
      expect(startupHides({ ...DEFAULT_STARTUP, ...o })).toBe(true);
      expect(hasStartup({ ...DEFAULT_STARTUP, ...o }, false)).toBe(true);
    }
    // the title and the icon hide nothing (they apply also when bypassed, R4)
    expect(startupHides({ ...DEFAULT_STARTUP, appTitle: 'Gestion', appIcon: PNG_1PX_BASE64 })).toBe(false);
  });

  it('a newer or tampered value reads as the default', () => {
    expect(readStartup({ ribbon: 'custom', runMode: 'yes', showNavPane: 0, startupForm: 'a.b', v: 2 })).toEqual(DEFAULT_STARTUP);
    expect(readStartup([1, 2])).toEqual(DEFAULT_STARTUP);
    expect(readStartup('x')).toEqual(DEFAULT_STARTUP);
    expect(readStartup(null)).toEqual(DEFAULT_STARTUP);
    expect(readStartup({ appTitle: 5, appIcon: 5, startupForm: 5 })).toEqual(DEFAULT_STARTUP);
  });

  it('each key is read on its own', () => {
    expect(readStartup({ ribbon: 'custom', runMode: true, startupForm: 'FMenu', showNavPane: false }))
      .toEqual({ ...DEFAULT_STARTUP, runMode: true, startupForm: 'FMenu', showNavPane: false });
    expect(readStartup({ ribbon: 'simplified' }).ribbon).toBe('simplified');
  });

  it('returns a fresh object, never the shared default', () => {
    expect(readStartup(undefined)).not.toBe(DEFAULT_STARTUP);
  });

  it('cleans the title', () => {
    expect(cleanTitle('  Gestion\u202E des ventes\n ')).toBe('Gestion des ventes');
    expect(cleanTitle('a\u0000b\u0085c\u007Fd\u2066e\u2069f\u202Ag')).toBe('abcdefg');
    expect([...cleanTitle('é'.repeat(10_000))]).toHaveLength(255);
    expect([...cleanTitle('😀'.repeat(300))]).toHaveLength(255);
    expect(cleanTitle('a'.repeat(254) + ' b')).toBe('a'.repeat(254)); // a cut never leaves a trailing blank
    expect(readStartup({ appTitle: 'Gestion des ventes' }).appTitle).toBe('Gestion des ventes');
    expect(readStartup({ appTitle: ' x\u202E ' }).appTitle).toBe('x');
  });

  it('keeps a PNG icon only', () => {
    expect(readStartup({ appIcon: PNG_1PX_BASE64 }).appIcon).toBe(PNG_1PX_BASE64);
    expect(readStartup({ appIcon: btoa('GIF89a\u0001\u0000\u0001\u0000') }).appIcon).toBe('');
    expect(readStartup({ appIcon: 'A'.repeat(MAX_ICON_BASE64 + 4) }).appIcon).toBe('');
    expect(readStartup({ appIcon: 'not base64!' }).appIcon).toBe('');
    expect(readStartup({ appIcon: 'iVBORw0K' }).appIcon).toBe(''); // a truncated signature
    expect(readStartup({ appIcon: PNG_1PX_BASE64.slice(0, -1) }).appIcon).toBe(''); // not a multiple of 4
    expect(readStartup({ appIcon: ` ${PNG_1PX_BASE64}` }).appIcon).toBe('');
  });
});
