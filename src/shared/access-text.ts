// Reader of Access's SaveAsText format (forms and reports), batch E4.
/** A value of the text: a number, a string (escapes decoded, continuation lines joined), `NotDefault`, or a `Name = Begin … End` block (its lines, trimmed). */
export type AccessValue = number | string | { notDefault: true } | { lines: string[] }
export interface AccessBlock { type: string; props: Map<string, AccessValue>; blocks: AccessBlock[] }
export interface AccessText { header: Map<string, AccessValue>; root: AccessBlock; code: string; unread: number }
export class AccessTextError extends Error {
  constructor(readonly code: 'noRoot' | 'unbalanced' | 'tooDeep' | 'tooLong') { super(code) }
}
export const MAX_ACCESS_TEXT = 16_777_216 // UTF-16 units
const MAX_DEPTH = 50

const BEGIN = /^Begin(?:\s+(\S.*))?$/s
const PROP = /^([^=\s]+)\s*=\s*(.*)$/s
const PROP_BEGIN = /^[^=\s]+\s*=\s*Begin$/
const NUMBER = /^-?\d+(?:\.\d+)?$/

// True when the line opens a block: `Begin`, `Begin X`, or `Name = Begin`.
const opens = (l: string) => BEGIN.test(l) || PROP_BEGIN.test(l)

// Index just after the `End` that closes the block opened at lines[i]; throws when it never closes.
function blockEnd(lines: string[], i: number): number {
  let depth = 0
  for (let j = i; j < lines.length; j++) {
    if (lines[j] === 'End' && --depth === 0) return j + 1
    if (opens(lines[j])) depth++
  }
  throw new AccessTextError('unbalanced')
}

// The decoded string of `s` (which starts with a quote), up to the closing quote.
function unquote(s: string): string {
  let out = ''
  for (let i = 1; i < s.length; i++) {
    const c = s[i]
    if (c === '"') break
    if (c === '\\') {
      const oct = /^[0-7]{3}/.exec(s.slice(i + 1, i + 4))
      if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += 3; continue }
      if (s[i + 1] === '"' || s[i + 1] === '\\') { out += s[++i]; continue }
    }
    out += c
  }
  return out
}

// Reads the value `rest` (after the `=`) of the property line lines[i]; returns it and the index of the next line.
function readValue(lines: string[], i: number, rest: string): [AccessValue, number] {
  if (rest.startsWith('"')) {
    let s = unquote(rest)
    let j = i + 1
    while (j < lines.length && lines[j].startsWith('"')) s += unquote(lines[j++])
    return [s, j]
  }
  if (rest === 'NotDefault') return [{ notDefault: true }, i + 1]
  if (rest === 'Begin') {
    const content: string[] = []
    let depth = 1
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === 'End' && --depth === 0) return [{ lines: content }, j + 1]
      if (opens(lines[j])) depth++
      content.push(lines[j])
    }
    throw new AccessTextError('unbalanced')
  }
  return [NUMBER.test(rest) ? Number(rest) : rest, i + 1]
}

export function parseAccessText(text: string): AccessText {
  if (text.length > MAX_ACCESS_TEXT) throw new AccessTextError('tooLong')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const header = new Map<string, AccessValue>()
  const stack: AccessBlock[] = []
  let root: AccessBlock | undefined
  let unread = 0
  let code = ''
  // trimmed lines, each with the offset of the text that follows it
  const lines: string[] = [], next: number[] = []
  for (let pos = 0; pos < text.length;) {
    let nl = text.indexOf('\n', pos)
    if (nl < 0) nl = text.length
    lines.push(text.slice(pos, nl).trim())
    next.push(nl + 1)
    pos = nl + 1
  }
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (line === '') { i++; continue }
    const top = stack[stack.length - 1]
    if (!top && root && (line === 'CodeBehindForm' || line === 'CodeBehindReport')) { code = text.slice(next[i]); break }
    if (line === 'End') {
      if (!stack.pop()) throw new AccessTextError('unbalanced')
      i++
      continue
    }
    const b = BEGIN.exec(line)
    if (b) {
      const block: AccessBlock = { type: (b[1] ?? '').trim(), props: new Map(), blocks: [] }
      if (top) top.blocks.push(block)
      else if (!root && (block.type === 'Form' || block.type === 'Report')) root = block
      else { const end = blockEnd(lines, i); for (let j = i; j < end; j++) if (lines[j] !== '') unread++; i = end; continue }
      stack.push(block)
      if (stack.length > MAX_DEPTH) throw new AccessTextError('tooDeep')
      i++
      continue
    }
    const p = PROP.exec(line)
    if (p && (top || !root)) {
      const [v, j] = readValue(lines, i, p[2])
      ;(top?.props ?? header).set(p[1], v)
      i = j
      continue
    }
    if (p && p[2] === 'Begin') { // a stray `Name = Begin` block after the root: skipped whole
      const end = blockEnd(lines, i); for (let j = i; j < end; j++) if (lines[j] !== '') unread++; i = end; continue
    }
    unread++
    i++
  }
  if (stack.length) throw new AccessTextError('unbalanced')
  if (!root) throw new AccessTextError('noRoot')
  return { header, root, code, unread }
}

/** The bytes of a hex block (`0x…` lines, an optional trailing ` ,`); null when a line is not hex. */
export function blockBytes(v: AccessValue | undefined): Uint8Array | null {
  if (typeof v !== 'object' || !('lines' in v)) return null
  let hex = ''
  for (const l of v.lines) {
    const m = /^0x([0-9a-fA-F]*)(?:\s*,)?$/.exec(l)
    if (!m || m[1].length % 2) return null
    hex += m[1]
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}
