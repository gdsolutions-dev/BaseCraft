// Lecture des fichiers texte à importer : encodage, découpage en enregistrements (délimité façon RFC 4180, largeur fixe),
// détection du format. Le fichier est lu par blocs : un fichier de 100 Mo ne passe jamais en entier en mémoire.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { ImportSpec, ResolvedEncoding } from '../../shared/import-text';

const CHUNK = 1 << 20;

/** BOM d'abord ; sinon UTF-8 si tous les octets en sont, sinon Windows-1252 (jamais de « QuantitÃ© »). */
export function detectEncoding(head: Uint8Array, utf8Valid: boolean): ResolvedEncoding {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  return utf8Valid ? 'utf-8' : 'windows-1252';
}

/** Parcourt le fichier par blocs : `fn(bloc, octetsLus, total)` ; `false` arrête la lecture. */
function eachChunk(path: string, fn: (chunk: Uint8Array, done: number, total: number) => boolean | void): void {
  const fd = openSync(path, 'r');
  try {
    const total = fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK);
    let done = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) return;
      done += n;
      if (fn(buf.subarray(0, n), done, total) === false) return;
    }
  } finally {
    closeSync(fd);
  }
}

/** Encodage du fichier : tout le fichier est vérifié (un « é » à la ligne 100 000 compte autant qu'à la première). */
export function sniffEncoding(path: string): ResolvedEncoding {
  let head: Uint8Array | null = null;
  let valid = true;
  const dec = new TextDecoder('utf-8', { fatal: true });
  eachChunk(path, (c) => {
    head ??= c.slice(0, 4);
    if (head[0] === 0xff && head[1] === 0xfe) return false;
    try { dec.decode(c, { stream: true }); } catch { valid = false; return false; }
  });
  if (valid) try { dec.decode(); } catch { valid = false; } // séquence tronquée en fin de fichier
  return detectEncoding(head ?? new Uint8Array(), valid);
}

/** Un enregistrement : ses champs, sa première ligne physique, et `unclosed` si un qualificateur n'y a jamais été fermé. */
export type Rec = string[] & { line: number; unclosed?: true };
/** Bornes d'un champ qualifié : au-delà, son qualificateur ouvrant est tenu pour du texte (mémoire bornée, rien d'avalé). */
export const QUOTED_MAX_CHARS = 1 << 20;
export const QUOTED_MAX_LINES = 1000;
/** Ligne et marque hors des champs énumérables : un enregistrement reste un simple tableau de textes (IPC, comparaisons). */
export const tag = (fields: string[], line: number, unclosed = false): Rec => {
  Object.defineProperty(fields, 'line', { value: line });
  if (unclosed) Object.defineProperty(fields, 'unclosed', { value: true });
  return fields as Rec;
};

/**
 * Découpe en enregistrements, par morceaux de texte successifs. `delim` vide : une ligne = un enregistrement d'un seul champ.
 * Un qualificateur en début de champ ouvre un champ qui peut contenir séparateurs, retours à la ligne et qualificateurs
 * doublés. Fins de ligne CRLF, LF ou CR ; lignes vides ignorées. Un qualificateur jamais fermé (fin du fichier, ou champ
 * au-delà des bornes) devient du texte : la suite est relue normalement et l'enregistrement est marqué `unclosed`.
 */
export function recordSplitter(delim: string, qual: string) {
  let field = '';
  let rec: string[] = [];
  let inQ = false; // dans un champ qualifié
  let afterQ = false; // qualificateur fermant vu : un second le double
  let quoted = false; // le champ courant a commencé par un qualificateur
  let anyQuoted = false; // l'enregistrement a un champ qualifié ("" seul sur sa ligne n'est pas une ligne vide)
  let skipLF = false; // CR vu : un LF qui suit appartient à la même fin de ligne
  let line = 1; // ligne physique du prochain caractère
  let prevCR = false;
  let started = false;
  let recLine = 1;
  let unclosed = false;
  let qRaw = ''; // texte lu depuis le qualificateur ouvrant, pour le relire s'il n'est jamais fermé
  let qLines = 0;
  let qLine = 1;
  const endField = () => { rec.push(field); field = ''; afterQ = false; quoted = false; };
  const endRecord = (out: string[][]) => {
    if (!(rec.length === 1 && rec[0] === '' && !anyQuoted)) out.push(tag(rec, recLine, unclosed));
    rec = []; anyQuoted = false; unclosed = false; started = false;
  };
  /** The opening qualifier of the current field is data: what followed it is read again, unqualified for that field. */
  const fail = (out: string[][]) => {
    const text = qRaw;
    inQ = false; afterQ = false; quoted = false; field = qual; unclosed = true;
    qRaw = ''; qLines = 0; line = qLine; prevCR = false;
    feed(text, out);
  };
  function feed(text: string, out: string[][]): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const at = line;
      if (c === '\r' || (c === '\n' && !prevCR)) line++;
      prevCR = c === '\r';
      if (skipLF) { skipLF = false; if (c === '\n') continue; }
      if (!started) { started = true; recLine = at; }
      if (inQ) {
        qRaw += c;
        if (c === '\n' || c === '\r') qLines++;
        if (c === qual) { inQ = false; afterQ = true; } else field += c;
        if (inQ && (qRaw.length > QUOTED_MAX_CHARS || qLines > QUOTED_MAX_LINES)) fail(out);
        continue;
      }
      if (afterQ && c === qual) { qRaw += c; field += c; inQ = true; afterQ = false; continue; }
      if (afterQ && c !== delim && c !== '\n' && c !== '\r' && c !== ' ' && c !== '\t') {
        // text right after a closing qualifier: that qualifier was the opening of another field, ours was never closed
        qRaw += c;
        fail(out);
        continue;
      }
      afterQ = false; // the closing qualifier is final: nothing to read again
      qRaw = '';
      qLines = 0;
      if (c === delim) {
        endField();
      } else if (c === '\n' || c === '\r') {
        endField(); endRecord(out);
        skipLF = c === '\r';
      } else if (c === qual && field === '' && !quoted) {
        inQ = true; quoted = true; anyQuoted = true; qLine = line;
      } else {
        field += c;
        // an unquoted field (or a fixed-width line) has the same bound: memory stays bounded, the error is typed
        if (field.length > QUOTED_MAX_CHARS) throw new Error('bc:fieldTooLong');
      }
    }
  }
  return {
    push: feed,
    end(out: string[][]): void {
      while (inQ) fail(out);
      if (rec.length > 0 || field !== '' || anyQuoted) { endField(); endRecord(out); }
    },
  };
}

/** Champs d'une ligne à largeur fixe (positions en caractères), espaces de fin retirés. */
export function sliceFixed(line: string, breaks: readonly number[]): string[] {
  const chars = [...line];
  const starts = [0, ...breaks];
  return starts.map((s, i) => chars.slice(s, starts[i + 1] ?? chars.length).join('').trim());
}

/** Coupures proposées : chaque colonne qui suit une colonne blanche dans toutes les lignes de l'échantillon. */
export function proposeBreaks(lines: readonly string[]): number[] {
  const rows = lines.filter((l) => l.trim() !== '').map((l) => [...l]);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const blank = (i: number) => rows.every((r) => i >= r.length || r[i] === ' ' || r[i] === '\t');
  const out: number[] = [];
  for (let i = 1; i < width; i++) if (blank(i - 1) && !blank(i)) out.push(i);
  return out;
}

/** Enregistrements d'un texte déjà décodé (échantillon de l'aperçu) ; `final` : le texte va jusqu'à la fin du fichier. */
export function splitRecords(text: string, o: { spec: ImportSpec; raw?: boolean }, final: boolean): Rec[] {
  const fixed = o.raw || o.spec.format === 'fixed';
  const split = fixed ? recordSplitter('', '') : recordSplitter(o.spec.delimiter, o.spec.qualifier);
  const out: Rec[] = [];
  split.push(text, out);
  if (final) split.end(out);
  return fixed && !o.raw ? out.map((r) => tag(sliceFixed(r[0], o.spec.breaks), r.line, r.unclosed)) : out;
}

export interface ReadOptions { spec: ImportSpec; encoding: ResolvedEncoding; raw?: boolean }
/** Enregistrements du fichier, au fil de la lecture ; `raw` : lignes brutes (un champ chacune). `progress` : octets lus. */
export function* readRecords(path: string, o: ReadOptions, progress?: (done: number, total: number) => void): Generator<Rec> {
  const fixed = o.raw || o.spec.format === 'fixed';
  const split = fixed ? recordSplitter('', '') : recordSplitter(o.spec.delimiter, o.spec.qualifier);
  const dec = new TextDecoder(o.encoding); // retire le BOM
  const fd = openSync(path, 'r');
  try {
    const total = fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK);
    let done = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      const out: Rec[] = [];
      if (n === 0) {
        split.push(dec.decode(), out);
        split.end(out);
      } else {
        done += n;
        split.push(dec.decode(buf.subarray(0, n), { stream: true }), out);
      }
      for (const r of out) yield fixed && !o.raw ? tag(sliceFixed(r[0], o.spec.breaks), r.line, r.unclosed) : r;
      progress?.(done, total);
      if (n === 0) return;
    }
  } finally {
    closeSync(fd);
  }
}

export function take<T>(it: Iterable<T>, n: number): T[] {
  const out: T[] = [];
  if (n <= 0) return out;
  for (const x of it) { out.push(x); if (out.length >= n) break; } // break : le générateur ferme le fichier
  return out;
}

const CANDIDATES = ['\t', ';', ',', ' '];

/** Séparateur dont le nombre de champs (≥ 2) est le même sur au moins 80 % des lignes ; null sinon. */
export function detectDelimiter(text: string, qual: string): string | null {
  let best: { d: string; score: number; count: number } | null = null;
  for (const d of CANDIDATES) {
    const out: string[][] = [];
    const s = recordSplitter(d, qual);
    s.push(text, out);
    s.end(out);
    const sample = out.slice(0, 50);
    if (sample.length === 0) continue;
    const freq = new Map<number, number>();
    for (const r of sample) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    const [count, n] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (count < 2 || n < sample.length * 0.8) continue;
    if (d === ' ' && best) continue; // l'espace en dernier recours
    if (!best || n > best.score) best = { d, score: n, count };
  }
  return best?.d ?? null;
}

/** Format probable : délimité si un séparateur est régulier, largeur fixe si des colonnes s'alignent, délimité sinon. */
export function detectFormat(lines: readonly string[]): Pick<ImportSpec, 'format' | 'delimiter' | 'breaks'> {
  const text = lines.join('\n');
  const d = detectDelimiter(text, '"');
  if (d && d !== ' ') return { format: 'delimited', delimiter: d, breaks: [] };
  const breaks = proposeBreaks(lines);
  if (breaks.length > 0 && lines.some((l) => /\S {2,}\S/.test(l))) return { format: 'fixed', delimiter: ',', breaks };
  return { format: 'delimited', delimiter: d ?? ',', breaks };
}
