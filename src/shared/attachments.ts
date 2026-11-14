// Attachment fields (C5): limits, the file name a base keeps, what a dialog row shows. Pure (renderer and main).
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // Access's 25 MB per file here, a limit of BaseCraft's own (one SQLite value)
export const ATTACHMENT_PREVIEW_MAX_BYTES = 8 * 1024 * 1024; // an image over this shows as an icon

export interface AttachmentInfo { id: number; name: string; /** lowercase extension, no dot ('' if none) */ type: string; bytes: number }

/** The name a base keeps: the last path part, characters Windows refuses replaced, 1 to 255 characters; null when nothing is left. */
export function attachmentName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  let n = (raw.split(/[\\/]/).pop() ?? '').replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trimStart();
  if (n === '' || /^\.+$/.test(n)) return null;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `_${n}`; // a Windows device name
  return [...n].slice(0, 255).join('');
}

export const attachmentType = (name: string): string => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();

/** A file whose opening can run code (Windows, macOS, Linux): the confirmation says so (never opened silently). */
export const RUNNABLE = new Set(['exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'pif', 'reg', 'cpl', 'msc', 'dll', 'app', 'command', 'sh', 'appimage', 'desktop']);
export const isRunnable = (name: string): boolean => RUNNABLE.has(attachmentType(name));

/** What a report prints for an Attachment cell: its first file, as a picture (`src`, a data URL) or the file-type icon. */
export interface AttachmentFace { name: string; type: string; src: string | null }

const xml = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** The file-type icon (a page with its extension and the file name) as an SVG data URL: what the form control draws without a picture. */
export function attachmentIconSrc(name: string, type: string): string {
  const label = xml(type.slice(0, 5).toUpperCase()), shown = xml([...name].length > 24 ? `${[...name].slice(0, 23).join('')}…` : name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M30 8h42l22 22v70a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6z" fill="#fff" stroke="#6b7280" stroke-width="3"/>`
    + `<path d="M72 8v22h22" fill="none" stroke="#6b7280" stroke-width="3"/><text x="59" y="72" font-family="Arial,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#374151">${label}</text>`
    + `<text x="60" y="114" font-family="Arial,sans-serif" font-size="9" text-anchor="middle" fill="#374151">${shown}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
