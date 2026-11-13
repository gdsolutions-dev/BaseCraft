// Rich Text (a Long Text field whose Text Format is Rich Text): the stored value is a limited HTML subset. The values come from
// bases received by e-mail, so every read and every write goes through sanitizeRich, an allow-list: a tag outside the list
// loses its markup (its text stays), an attribute outside the list is dropped, and a style keeps only values of a strict
// grammar. Pure string code (no DOM): the main process, the report layout and the renderer share it.

/** The tags kept. Everything else is reduced to its text (no `a`, no `img`: no URL ever survives). */
const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span', 'font', 'ul', 'ol', 'li', 'blockquote']);
/** The tags whose content is dropped with them (code, embedded documents). */
const DROPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'xmp', 'noembed', 'noframes', 'frameset']);
/** The tags that take style and dir (the browser puts a highlight or a colour on the b or u it already has). */
const STYLED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'div', 'p', 'span', 'font', 'ul', 'ol', 'li', 'blockquote']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** The text of an entity-encoded string (the named entities BaseCraft writes and the browser's, plus numeric ones). */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name]!;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
  });
}
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

type Token = { text: string } | { tag: string; close: boolean; attrs: string };
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/y;

/** The text and the tags of `html`; comments, declarations and the content of DROPPED tags are left out. A `<` that opens no
 *  tag is text. */
function* tokens(html: string): Generator<Token> {
  let i = 0, text = '';
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    TAG.lastIndex = lt;
    const m = TAG.exec(html);
    if (!m) {
      const decl = /^<[!?][^>]*>/.exec(html.slice(lt, lt + 4096));   // <!doctype>, <?xml?>: dropped
      if (decl) { i = lt + decl[0].length; continue; }
      text += '<'; i = lt + 1; continue;
    }
    i = lt + m[0].length;
    const tag = m[2]!.toLowerCase(), close = m[1] === '/';
    if (text) { yield { text }; text = ''; }
    if (DROPPED.has(tag) && !close) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i);
      if (end < 0) break;
      const gt = html.indexOf('>', end);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    yield { tag, close, attrs: m[3]! };
  }
  if (text) yield { text };
}

const COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\))$/i;
const LENGTH = /^\d+(?:\.\d+)?(?:px|pt|em|cm|in)?$/i;
const ALIGN = /^(?:left|right|center|justify)$/i;

/** The style attribute reduced to color, background-color, margin-left and text-align. Chromium writes an indent as
 *  `margin: 0 0 0 40px`: read as margin-left. */
function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of decodeEntities(style).split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase(), value = decl.slice(colon + 1).trim().replace(/\s*!important$/i, '');
    if ((name === 'color' || name === 'background-color') && COLOR.test(value)) out.push(`${name}:${value}`);
    else if (name === 'text-align' && ALIGN.test(value)) out.push(`${name}:${value.toLowerCase()}`);
    else if (name === 'margin-left' && LENGTH.test(value)) out.push(`${name}:${value}`);
    else if (name === 'margin') {
      const m = /^0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+(\d+(?:\.\d+)?(?:px|pt|em|cm|in)?)$/i.exec(value);
      if (m) out.push(`margin-left:${m[1]}`);
    }
  }
  return out.join(';');
}

const ATTR = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** The attributes kept of a tag, as markup (` style="…"`): style and dir on the styled tags, color on `font`. */
function cleanAttrs(tag: string, attrs: string): string {
  if (!STYLED.has(tag)) return '';
  let out = '';
  const seen = new Set<string>();
  for (const m of attrs.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase(), value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'style') { const s = cleanStyle(value); if (s) out += ` style="${escapeAttr(s)}"`; }
    else if (name === 'dir' && /^(?:ltr|rtl)$/i.test(value)) out += ` dir="${value.toLowerCase()}"`;
    else if (name === 'color' && tag === 'font' && COLOR.test(value.trim())) out += ` color="${escapeAttr(value.trim())}"`;
  }
  return out;
}

/** `html` reduced to the allowed subset: balanced tags, text escaped, no script, handler, URL or unlisted style. */
export function sanitizeRich(html: string): string {
  let out = '';
  const open: string[] = [];
  for (const t of tokens(html.replace(CONTROLS, ''))) {
    if ('text' in t) { out += escapeText(decodeEntities(t.text)); continue; }
    if (!TAGS.has(t.tag)) continue;
    if (t.tag === 'br') { if (!t.close) out += '<br>'; continue; }
    if (!t.close) { out += `<${t.tag}${cleanAttrs(t.tag, t.attrs)}>`; open.push(t.tag); continue; }
    const at = open.lastIndexOf(t.tag);
    if (at < 0) continue;   // a closing tag nothing opened
    while (open.length > at) out += `</${open.pop()}>`;
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** The text of a rich value: tags gone, entities decoded, a line per block or `<br>`, list items marked (« • », « 1. »). */
export function richToPlain(html: string): string {
  let out = '';
  const lists: { ordered: boolean; n: number }[] = [];
  const newline = () => { if (out !== '' && !out.endsWith('\n')) out += '\n'; };
  for (const t of tokens(html.replace(CONTROLS, ''))) {
    if ('text' in t) { const x = decodeEntities(t.text).replace(/\s+/g, ' '); out += out === '' || out.endsWith('\n') ? x.trimStart() : x; continue; }
    if (t.tag === 'br') { if (!t.close) out += '\n'; continue; }
    if (t.tag === 'ul' || t.tag === 'ol') {
      newline();
      if (t.close) lists.pop(); else lists.push({ ordered: t.tag === 'ol', n: 0 });
    } else if (t.tag === 'li') {
      newline();
      const l = lists[lists.length - 1];
      if (!t.close) out += !l ? '• ' : l.ordered ? `${++l.n}. ` : '• ';
    } else if (t.tag === 'div' || t.tag === 'p' || t.tag === 'blockquote') newline();
  }
  return out.replace(/\n+$/, '');
}
