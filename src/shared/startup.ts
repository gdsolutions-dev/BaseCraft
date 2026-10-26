// Options de démarrage de la base (bc_meta, options.startup) : le modèle, sans E/S. Le contenu vient d'un fichier non fiable :
// chaque clé est lue seule, une valeur fausse ou inconnue (d'une version plus récente) donne le défaut, et chaque défaut
// montre plus, jamais moins : le propriétaire n'est jamais enfermé dehors (R12).
import { isValidObjectName } from './field-types';

export interface StartupOptions {
  /** '' : BaseCraft's title. */
  appTitle: string;
  /** '' : BaseCraft's icon; else a base64 PNG. */
  appIcon: string;
  /** '' : none. */
  startupForm: string;
  showNavPane: boolean;
  ribbon: 'full' | 'simplified';
  runMode: boolean;
}

export const DEFAULT_STARTUP: StartupOptions = Object.freeze({
  appTitle: '', appIcon: '', startupForm: '', showNavPane: true, ribbon: 'full', runMode: false,
});

/** Access's limit for a text property, in code points. */
export const MAX_APP_TITLE = 255;
/** The stored icon (a PNG re-encoded to at most 256 x 256), in base64 characters. */
export const MAX_ICON_BASE64 = 700_000;

/** A window title: C0 and C1 controls and the bidirectional overrides and isolates removed (they could reorder the text
 *  shown), trimmed, at most MAX_APP_TITLE code points. Idempotent. */
export function cleanTitle(s: string): string {
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u202A-\u202E\u2066-\u2069]/g, '').trim();
  let out = '';
  let n = 0;
  for (const ch of t) { // stops at the limit: a huge string is never spread
    if (n++ === MAX_APP_TITLE) break;
    out += ch;
  }
  return out.trimEnd();
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Base64 of at most MAX_ICON_BASE64 characters whose bytes start with the PNG signature. The size of the picture is
 *  checked where the PNG is decoded, from its header, before any decoding. */
export function isValidIcon(s: string): boolean {
  if (s.length < 12 || s.length > MAX_ICON_BASE64 || s.length % 4 !== 0 || !BASE64.test(s)) return false;
  const head = atob(s.slice(0, 12)); // 9 bytes: the 8 of the signature are read from the first 12 characters only
  return PNG_SIGNATURE.every((b, i) => head.charCodeAt(i) === b);
}

/** The options as stored, key by key (R12). Never throws; always a new object. */
export function readStartup(raw: unknown): StartupOptions {
  const o: Record<string, unknown> = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    appTitle: typeof o.appTitle === 'string' ? cleanTitle(o.appTitle) : DEFAULT_STARTUP.appTitle,
    appIcon: typeof o.appIcon === 'string' && isValidIcon(o.appIcon) ? o.appIcon : DEFAULT_STARTUP.appIcon,
    startupForm: typeof o.startupForm === 'string' && isValidObjectName(o.startupForm) ? o.startupForm : DEFAULT_STARTUP.startupForm,
    showNavPane: typeof o.showNavPane === 'boolean' ? o.showNavPane : DEFAULT_STARTUP.showNavPane,
    ribbon: o.ribbon === 'simplified' ? 'simplified' : DEFAULT_STARTUP.ribbon,
    runMode: typeof o.runMode === 'boolean' ? o.runMode : DEFAULT_STARTUP.runMode,
  };
}

/** Whether the options hide or open something Shift can bypass (the title and the icon hide nothing: they always apply). */
export function startupHides(o: StartupOptions): boolean {
  return o.startupForm !== '' || !o.showNavPane || o.ribbon === 'simplified' || o.runMode;
}

/** Something Shift can bypass: options that hide or open something, or an AutoExec macro. */
export function hasStartup(o: StartupOptions, autoExec: boolean): boolean {
  return startupHides(o) || autoExec;
}
