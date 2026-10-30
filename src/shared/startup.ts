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
  /** Display the status bar. */
  statusBar: boolean;
  /** Display the document tabs. */
  documentTabs: boolean;
  /** Use the special keys (F11 shows or hides the Navigation Pane). */
  specialKeys: boolean;
  /** Compact the base when it closes (read by the main process at close). */
  compactOnClose: boolean;
  /** Table design changes in Datasheet view. */
  datasheetDesign: boolean;
  /** Off: run mode without the pane rule (R4). */
  fullMenus: boolean;
  /** Off: the Navigation Pane opens no shortcut menu. */
  shortcutMenus: boolean;
  /** The application icon is the icon of forms and reports (needs appIcon). */
  iconForForms: boolean;
  /** A front-end application: its local tables are reference only (C3 R1). */
  frontEnd: boolean;
  /** A shared data file: opened in shared mode by several workstations (C3 R1). */
  dataFile: boolean;
}

export const DEFAULT_STARTUP: StartupOptions = Object.freeze({
  appTitle: '', appIcon: '', startupForm: '', showNavPane: true, ribbon: 'full', runMode: false,
  statusBar: true, documentTabs: true, specialKeys: true, compactOnClose: false, datasheetDesign: true, fullMenus: true, shortcutMenus: true, iconForForms: false,
  frontEnd: false, dataFile: false,
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
    statusBar: typeof o.statusBar === 'boolean' ? o.statusBar : DEFAULT_STARTUP.statusBar,
    documentTabs: typeof o.documentTabs === 'boolean' ? o.documentTabs : DEFAULT_STARTUP.documentTabs,
    specialKeys: typeof o.specialKeys === 'boolean' ? o.specialKeys : DEFAULT_STARTUP.specialKeys,
    compactOnClose: typeof o.compactOnClose === 'boolean' ? o.compactOnClose : DEFAULT_STARTUP.compactOnClose,
    datasheetDesign: typeof o.datasheetDesign === 'boolean' ? o.datasheetDesign : DEFAULT_STARTUP.datasheetDesign,
    fullMenus: typeof o.fullMenus === 'boolean' ? o.fullMenus : DEFAULT_STARTUP.fullMenus,
    shortcutMenus: typeof o.shortcutMenus === 'boolean' ? o.shortcutMenus : DEFAULT_STARTUP.shortcutMenus,
    iconForForms: typeof o.iconForForms === 'boolean' ? o.iconForForms : DEFAULT_STARTUP.iconForForms,
    frontEnd: typeof o.frontEnd === 'boolean' ? o.frontEnd : DEFAULT_STARTUP.frontEnd,
    dataFile: typeof o.dataFile === 'boolean' ? o.dataFile : DEFAULT_STARTUP.dataFile,
  };
}

/** Whether the options hide or open something Shift can bypass (the title, the icon, the icon for forms and compact on close
 *  hide nothing: they always apply, R2). */
export function startupHides(o: StartupOptions): boolean {
  return o.startupForm !== '' || !o.showNavPane || o.ribbon === 'simplified' || o.runMode
    || !o.statusBar || !o.documentTabs || !o.specialKeys || !o.datasheetDesign || !o.fullMenus || !o.shortcutMenus;
}

/** Something Shift can bypass: options that hide or open something, or an AutoExec macro. */
export function hasStartup(o: StartupOptions, autoExec: boolean): boolean {
  return startupHides(o) || autoExec;
}
