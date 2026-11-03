// Les serveurs que la feuille de propriétés d'une requête SQL direct offre sous « Connexion » (C6 R3) : un par connexion
// distincte, la connexion de la requête toujours telle qu'elle est. Module pur.
import type { ServerKind } from '../../shared/api';

export interface Server { kind: ServerKind; params: Record<string, unknown> }
/** A SQL Server's named instance (C5 R2), '' without one. */
const instanceOf = (p: Record<string, unknown>): string => (typeof p.instance === 'string' ? p.instance : '');
/** host:port/database, or host\instance/database for a named instance (its port unused), as the main process writes it
 *  (pgLabel, msLabel, LinkInfo.path). */
export const serverLabel = (p: Record<string, unknown>): string =>
  `${String(p.host)}${instanceOf(p) ? `\\${instanceOf(p)}` : `:${String(p.port)}`}/${String(p.database)}`;
/** A connection's identity: pgKey's or msKey's (kind, host and instance in lower case, else the port, database, TLS mode) and
 *  the user. */
const keyOf = ({ kind, params: p }: Server): string =>
  `${kind}://${String(p.host).toLowerCase()}${instanceOf(p) ? `\\${instanceOf(p).toLowerCase()}` : `:${String(p.port)}`}/${String(p.database)}?tls=${String(p.tls)}&user=${String(p.user)}`;

/** The Connexion list: the links' servers, one per connection, `current` (the pass-through's own params, exactly) in place of
 *  the link of the same connection or first; a label two entries share gets the TLS mode, then also the user. `selected`:
 *  current's index, -1 without one. */
export function serverOptions(current: Server | null, links: Server[]): { options: (Server & { label: string })[]; selected: number } {
  const all: Server[] = [];
  const at = new Map<string, number>();
  for (const s of links) if (!at.has(keyOf(s))) { at.set(keyOf(s), all.length); all.push(s); }
  let selected = -1;
  if (current) {
    const i = at.get(keyOf(current));
    if (i === undefined) all.unshift(current);
    else all[i] = current;
    selected = i ?? 0;
  }
  const options = all.map((s) => {
    const base = serverLabel(s.params);
    const same = all.filter((o) => serverLabel(o.params) === base);
    if (same.length === 1) return { ...s, label: base };
    const tls = String(s.params.tls);
    return { ...s, label: same.filter((o) => String(o.params.tls) === tls).length === 1 ? `${base} (${tls})` : `${base} (${tls}, ${String(s.params.user)})` };
  });
  return { options, selected };
}
