// A PostgreSQL source's params (C4 R6, R10, R11). Pure: loads nothing.

export interface PgParams { host: string; port: number; database: string; user: string; tls: 'verify-full' | 'require' | 'disable'; timeout: number }

const invalid = (): never => { throw new Error('bc:invalidArgument'); };
const text = (v: unknown, max: number): string => (typeof v === 'string' && v.length >= 1 && v.length <= max ? v : invalid());
const int = (v: unknown, min: number, max: number, dflt: number): number =>
  v === undefined ? dflt : Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : invalid();
const TLS = ['verify-full', 'require', 'disable'] as const;
/** A host name or address (IPv6 unbracketed): nothing that could read as another part of the key, no space or control. */
const host = (v: unknown): string => {
  const h = text(v, 253);
  return /[/?#\s\p{Cc}]/u.test(h) ? invalid() : h.toLowerCase();
};

/** The six params only, defaults filled, host lower-cased (`addServerLinks` stores them as given: a source is reused on equal
 *  params); else bc:invalidArgument. host 1..253 without / ? # space or control, port 1..65535 (5432), database and user
 *  1..63, tls (verify-full), timeout 0..3600 s (60). */
export function pgParams(v: unknown): PgParams {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) invalid();
  const p = v as Record<string, unknown>;
  const tls = p.tls === undefined ? 'verify-full' : TLS.find((x) => x === p.tls) ?? invalid();
  return { host: host(p.host), port: int(p.port, 1, 65535, 5432), database: text(p.database, 63), user: text(p.user, 63), tls, timeout: int(p.timeout, 0, 3600, 60) };
}

/** R10 with Task 5's ruling: never the user, always the TLS mode (a remembered password never goes to a weaker mode). */
export const pgKey = (p: PgParams): string => `postgresql://${p.host.toLowerCase()}:${p.port}/${p.database}?tls=${p.tls}`;
export const pgLabel = (p: PgParams): string => `${p.host}:${p.port}/${p.database}`;
