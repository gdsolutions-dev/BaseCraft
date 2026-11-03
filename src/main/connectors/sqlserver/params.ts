// A SQL Server source's params (C5 R2, R3). Pure: loads nothing.

export interface MsParams { host: string; instance?: string; port: number; database: string; user: string; tls: 'verify-full' | 'require' | 'disable'; timeout: number }

const invalid = (): never => { throw new Error('bc:invalidArgument'); };
const text = (v: unknown, max: number): string => (typeof v === 'string' && v.length >= 1 && v.length <= max ? v : invalid());
const int = (v: unknown, min: number, max: number, dflt: number): number =>
  v === undefined ? dflt : Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : invalid();
const TLS = ['verify-full', 'require', 'disable'] as const;
/** As pgParams' host, and no `\` (the instance has its own part). */
const host = (v: unknown): string => {
  const h = text(v, 253);
  return /[/?#\\\s\p{Cc}]/u.test(h) ? invalid() : h.toLowerCase();
};

/** The seven params only, defaults filled, host lower-cased; else bc:invalidArgument. host as pgParams' without `\`, instance
 *  1..16 of [A-Za-z0-9_$#-] (absent when empty), port 1..65535 (1433), database and user 1..128, tls (verify-full),
 *  timeout 0..3600 s (60). */
export function msParams(v: unknown): MsParams {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) invalid();
  const p = v as Record<string, unknown>;
  const tls = p.tls === undefined ? 'verify-full' : TLS.find((x) => x === p.tls) ?? invalid();
  const instance = p.instance === undefined || p.instance === '' ? undefined : /^[A-Za-z0-9_$#-]{1,16}$/.test(String(p.instance)) && typeof p.instance === 'string' ? p.instance : invalid();
  return { host: host(p.host), ...(instance !== undefined ? { instance } : {}), port: int(p.port, 1, 65535, 1433), database: text(p.database, 128), user: text(p.user, 128), tls, timeout: int(p.timeout, 0, 3600, 60) };
}

/** R2: never the user, always the TLS mode (as pgKey); with an instance the port is not part of it. */
export const msKey = (p: MsParams): string =>
  `sqlserver://${p.host.toLowerCase()}${p.instance !== undefined ? `\\${p.instance.toLowerCase()}` : `:${p.port}`}/${p.database}?tls=${p.tls}`;
export const msLabel = (p: MsParams): string => `${p.host}${p.instance !== undefined ? `\\${p.instance}` : `:${p.port}`}/${p.database}`;
