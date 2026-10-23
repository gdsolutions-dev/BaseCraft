// Lecture minimale d'un fichier TrueType (head, hhea, hmtx, post, cmap, name) : les avances et métriques verticales
// de font-metrics.json. Le test (BC_WRITE_FONT_METRICS=1) régénère le JSON ; l'application ne lit jamais de TTF.
import type { FontMetrics } from '../../shared/font-metrics';

export function readMetrics(buf: Uint8Array): FontMetrics & { version: string } {
  try {
    return parse(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
  } catch {
    throw new Error('bad font');
  }
}

function parse(dv: DataView): FontMetrics & { version: string } {
  const tables = new Map<string, number>();
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const at = 12 + 16 * i;
    const tag = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    const offset = dv.getUint32(at + 8);
    if (offset + dv.getUint32(at + 12) > dv.byteLength) throw new Error('table out of file');
    tables.set(tag, offset);
  }
  const table = (tag: string): number => {
    const t = tables.get(tag);
    if (t === undefined) throw new Error(`missing ${tag}`);
    return t;
  };
  const head = table('head'), hhea = table('hhea'), hmtx = table('hmtx'), post = table('post');
  const numberOfHMetrics = dv.getUint16(hhea + 34);
  if (numberOfHMetrics === 0) throw new Error('no hmtx');
  const advance = (glyph: number): number => dv.getUint16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));

  const runs: [number, number[]][] = [];
  for (const [cp, glyph] of readCmap(dv, table('cmap'))) {
    const last = runs.at(-1);
    if (last && last[0] + last[1].length === cp) last[1].push(advance(glyph));
    else runs.push([cp, [advance(glyph)]]);
  }
  return {
    upm: dv.getUint16(head + 18),
    ascender: dv.getInt16(hhea + 4), descender: dv.getInt16(hhea + 6), lineGap: dv.getInt16(hhea + 8),
    underlinePos: dv.getInt16(post + 8), underlineThickness: dv.getInt16(post + 10),
    runs, version: readVersion(dv, table('name')),
  };
}

/** Mapped BMP code points in increasing order, with their glyph: subtable (3,10) format 12, otherwise (3,1) format 4. */
function readCmap(dv: DataView, cmap: number): Map<number, number> {
  const sub = (platform: number, encoding: number, format: number): number | undefined => {
    for (let i = 0, n = dv.getUint16(cmap + 2); i < n; i++) {
      const at = cmap + 4 + 8 * i;
      const offset = cmap + dv.getUint32(at + 4);
      if (dv.getUint16(at) === platform && dv.getUint16(at + 2) === encoding && dv.getUint16(offset) === format) return offset;
    }
    return undefined;
  };
  const out = new Map<number, number>();
  const s12 = sub(3, 10, 12);
  if (s12 !== undefined) {
    for (let i = 0, n = dv.getUint32(s12 + 12); i < n; i++) {
      const at = s12 + 16 + 12 * i;
      const start = dv.getUint32(at), end = Math.min(dv.getUint32(at + 4), 0xffff), glyph = dv.getUint32(at + 8);
      for (let c = start; c <= end; c++) if (glyph + c - start !== 0) out.set(c, glyph + c - start);
    }
  } else {
    const s4 = sub(3, 1, 4);
    if (s4 === undefined) throw new Error('no unicode cmap');
    const segX2 = dv.getUint16(s4 + 6);
    const ends = s4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffsets = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const start = dv.getUint16(starts + s), end = dv.getUint16(ends + s);
      const delta = dv.getUint16(deltas + s), ro = dv.getUint16(rangeOffsets + s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g = ro === 0 ? c : dv.getUint16(rangeOffsets + s + ro + 2 * (c - start));
        if (ro !== 0 && g === 0) continue;
        g = (g + delta) & 0xffff;
        if (g !== 0) out.set(c, g);
      }
    }
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** name ID 5 (version): Windows UTF-16BE first, otherwise Macintosh Roman read as ASCII. */
function readVersion(dv: DataView, name: number): string {
  const strings = name + dv.getUint16(name + 4);
  let mac: string | undefined;
  for (let i = 0, n = dv.getUint16(name + 2); i < n; i++) {
    const at = name + 6 + 12 * i;
    if (dv.getUint16(at + 6) !== 5) continue;
    const platform = dv.getUint16(at), len = dv.getUint16(at + 8), off = strings + dv.getUint16(at + 10);
    if (platform === 3) {
      let s = '';
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k));
      return s;
    }
    if (platform === 1) mac ??= String.fromCharCode(...Array.from({ length: len }, (_, k) => dv.getUint8(off + k)));
  }
  if (mac === undefined) throw new Error('no version');
  return mac;
}
