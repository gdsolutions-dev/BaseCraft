// A hyperlink typed by the base author (a label's HyperlinkAddress): only web and mail links may leave the app. Checked in the
// renderer before asking and again in the main process before opening (a received base is not trusted).
const SCHEMES = ['http:', 'https:', 'mailto:'];
const MAX_LENGTH = 2048;

/** The URL to open (normalised), or null: not http:, https: or mailto:, empty, too long, or holding a control character. */
export function safeUrl(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s || s.length > MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!SCHEMES.includes(u.protocol)) return null;
  if (u.protocol !== 'mailto:' && (!u.hostname || u.username || u.password)) return null;   // no credentials in a link
  return u.href;
}
