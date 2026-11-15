// E6d: the mailto: URL of a mail draft (macro EMailDatabaseObject). Pure. Every component goes through encodeURIComponent, so
// nothing a field holds (`?subject=`, `&bcc=`, `%0D%0A`) can add a header; the body is cut to keep the URL within `max` characters.
export interface MailDraft { to: string; cc: string; bcc: string; subject: string; body: string }

const recipients = (s: string): string => s.split(/[;,]/).map((a) => a.trim()).filter(Boolean).map(encodeURIComponent).join(',');
const unit = (ch: string): string => { try { return encodeURIComponent(ch); } catch { return '%EF%BF%BD'; } };   // a lone surrogate: U+FFFD

export function mailtoUrl(m: MailDraft, max = 2000): string {
  const head = `mailto:${recipients(m.to)}`;
  const params = [['cc', recipients(m.cc)], ['bcc', recipients(m.bcc)], ['subject', m.subject ? encodeURIComponent(m.subject) : '']]
    .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  let url = head + (params.length ? `?${params.join('&')}` : '');
  let room = max - url.length - 6;   // "?body=" or "&body="
  if (!m.body || room <= 0) return url;
  // whole units (a code point, a line break) so a cut never leaves half a percent-escape or half a character
  let body = '';
  for (const part of m.body.split(/\r\n|\r|\n/).flatMap((l, i) => (i ? ['%0D%0A', ...Array.from(l, unit)] : Array.from(l, unit)))) {
    if (part.length > room) break;
    body += part; room -= part.length;
  }
  if (body) url += `${params.length ? '&' : '?'}body=${body}`;
  return url;
}

const LIMITS = { to: 2000, cc: 2000, bcc: 2000, subject: 500, body: 10000 } as const;
/** The draft the renderer sends: five strings within their limits; no control character (a line break only in the body). Else bc:invalidArgument. */
export function mailDraft(v: unknown): MailDraft {
  const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
  const out = {} as MailDraft;
  for (const k of Object.keys(LIMITS) as (keyof MailDraft)[]) {
    const s = o[k];
    // eslint-disable-next-line no-control-regex
    if (typeof s !== 'string' || s.length > LIMITS[k] || (k === 'body' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(s)) throw new TypeError('bc:invalidArgument');
    out[k] = s;
  }
  return out;
}
