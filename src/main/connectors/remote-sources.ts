// The front-end's server sources at run time (C4 R10, R11): one connection per source, opened on first use with the credential
// of its key, held in memory only (db-host's side of R10).
import type { DatabaseSync } from 'node:sqlite';
import { linkRows, sourceRows } from '../links/store';
import { isServerKind, type Capabilities, type Connection, type Connector, type Credentials } from './connector';
import type { ConnectorRegistry } from './registry';

/** A connector marks a lost connection (R11: 57P01, 08xxx, ECONNRESET, “Connection terminated”) as an Error with `lost: true`,
 *  and `unsent: true` too when the statement never left (the connection was already broken: nothing can have run). */
export const isLost = (e: unknown): boolean => e instanceof Error && (e as { lost?: unknown }).lost === true;
const isUnsent = (e: unknown): boolean => (e as { unsent?: unknown }).unsent === true;

type Open = { conn: Connection; connector: Connector; params: unknown };

export class RemoteSources {
  private readonly credentials = new Map<string, Credentials>();
  /** C6 Task 8: the keys whose credential was typed in this session (the login prompt, the link dialog), not pushed from the
   *  store: a pass-through of a file not trusted runs on these only. */
  private readonly typed = new Set<string>();
  /** The connection of each source, while it opens too: concurrent callers share one. */
  private readonly open = new Map<string, Promise<Open>>();
  /** close() ran: a connection that opens after it is closed at once, never kept. */
  private closed = false;
  /** db-host runs one call at a time: the connection of the `run` under way, if any (R12). */
  private busy: Connection | null = null;

  /** `passThroughs`: kind and params of the pass-through queries' servers (C6 R3): their keys are listed, so a server no link uses
   *  has its login too. */
  constructor(private readonly front: () => DatabaseSync, private readonly connectors: ConnectorRegistry,
    private readonly passThroughs: () => { kind: string; params: unknown }[] = () => []) {}

  /** Main's push (the store, or this session's login pushed again by takeOverLock): a key typed here stays typed. */
  setCredential(key: string, c: Credentials): void { this.credentials.set(key, c); }

  /** A server source's connector and params; bc:linkUnavailable|unsupportedKind|<a link's name> when this BaseCraft cannot read
   *  them (no label without them). */
  private describe(sourceId: string): { connector: Connector; params: unknown; key: string; label: string } {
    const row = sourceRows(this.front()).find((s) => s.id === sourceId);
    const connector = row && isServerKind(row.kind) ? this.connectors[row.kind] : undefined;
    let params: unknown;
    try { params = connector?.params(row!.params); } catch { /* unreadable params: unsupportedKind below */ }
    if (!connector || params === undefined) {
      throw new Error(`bc:linkUnavailable|unsupportedKind|${linkRows(this.front()).find((l) => l.sourceId === sourceId)?.name ?? ''}`);
    }
    return { connector, params, key: connector.key(params), label: connector.label(params) };
  }

  /** The source's open connection (opened on first use with its key's credential): bc:linkUnavailable|needsLogin|<key> without one
   *  or when the server refuses it (forgotten then); other connect failures bc:linkUnavailable|<state>|<label>. */
  connection(sourceId: string): Promise<Open> {
    const held = this.open.get(sourceId);
    if (held) return held;
    const o = this.opening(sourceId);
    this.open.set(sourceId, o);
    o.catch(() => { if (this.open.get(sourceId) === o) this.open.delete(sourceId); });
    return o;
  }

  private async opening(sourceId: string): Promise<Open> {
    const { connector, params, key, label } = this.describe(sourceId);
    const c = this.credentials.get(key);
    if (!c) throw new Error(`bc:linkUnavailable|needsLogin|${key}`);
    const conn = await this.connect(connector, params, c, true);
    if (this.closed) {
      await conn.close().catch(() => {});
      throw new Error(`bc:linkUnavailable|cannotConnect|${label}`);
    }
    return { conn, connector, params };
  }

  /** `connector.open`; a refused login forgets the key's credential when `forget`; a failure that is not bc: is cannotConnect. */
  private async connect(connector: Connector, params: unknown, c: Credentials, forget: boolean): Promise<Connection> {
    try {
      return await connector.open(params, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (forget && msg.startsWith('bc:linkUnavailable|needsLogin|')) {
        this.credentials.delete(connector.key(params));
        this.typed.delete(connector.key(params));
      }
      if (msg.startsWith('bc:')) throw e;
      throw new Error(`bc:linkUnavailable|cannotConnect|${connector.label(params)}`, { cause: e });
    }
  }

  /** The server link dialog (C4 Task 12): `fn` on a connection of `params` (no source needed), closed after. `typed`: the dialog's
   *  login, its key's credential once the server accepts it (a refused one leaves the key's credential as it was); null: the key's
   *  credential (needsLogin without one). */
  async probe<T>(connector: Connector, params: unknown, typed: Credentials | null, fn: (c: Connection) => Promise<T>): Promise<T> {
    const key = connector.key(params);
    const c = typed ?? this.credentials.get(key);
    if (!c) throw new Error(`bc:linkUnavailable|needsLogin|${key}`);
    const conn = await this.connect(connector, params, c, !typed);
    if (typed) { this.credentials.set(key, typed); this.typed.add(key); }
    try {
      return await fn(conn);
    } finally {
      await conn.close().catch(() => {});
    }
  }

  /** C6 R4: `fn` on a connection of its own to `params` of `kind` (the key's credential: bc:linkUnavailable|needsLogin|<key>
   *  without one or when refused, then forgotten), closed after; Stop reaches it (busy, as run()). A kind this BaseCraft has no
   *  connector for, or params it refuses: bc:linkUnavailable|unsupportedKind|<kind>. `stored` false (C6 Task 8, a file not
   *  trusted): a credential pushed from the store is not used, only one typed in this session — needsLogin|<key>|untrusted before
   *  connecting (no refusal: main keeps that credential, refusedKey; the login prompt says why, bridge.ts). */
  async once<T>(kind: string, params: unknown, stored: boolean, fn: (c: Connection, caps: Capabilities) => Promise<T>): Promise<T> {
    const connector = isServerKind(kind) ? this.connectors[kind] : undefined;
    let p: unknown;
    try { p = connector?.params(params); } catch { /* unreadable params: unsupportedKind below */ }
    if (!connector || p === undefined) throw new Error(`bc:linkUnavailable|unsupportedKind|${kind}`);
    if (!stored && !this.typed.has(connector.key(p))) {
      throw new Error(`bc:linkUnavailable|needsLogin|${connector.key(p)}|untrusted`);
    }
    return this.probe(connector, p, null, async (c) => {
      this.busy = c;
      try {
        return await fn(c, connector.capabilities);
      } finally {
        if (this.busy === c) this.busy = null;
      }
    });
  }

  /** R11: `fn` once more on a fresh connection when it fails with a lost connection (`isLost`). Writes pass `retry: false`:
   *  only a statement that never left (`unsent`) runs again; otherwise bc:serverError|connection|<message> (a write may have
   *  committed: never repeated, its outcome unknown, I1). A read lost again: bc:linkUnavailable|cannotConnect|<label>. A lost
   *  connection is always dropped. `fn` also gets its connector's capabilities. A run inside another's `fn` (C7 R12: Limit To
   *  List read during a save) leaves Stop on the outer one's connection when it ends. */
  async run<T>(sourceId: string, fn: (c: Connection, caps: Capabilities) => Promise<T>, retry: boolean, again = true): Promise<T> {
    const { conn, connector } = await this.connection(sourceId);
    const outer = this.busy;
    this.busy = conn;
    try {
      return await fn(conn, connector.capabilities);
    } catch (e) {
      if (!isLost(e)) throw e;
      await this.drop(sourceId);
      if (again && (retry || isUnsent(e))) return this.run(sourceId, fn, retry, false);
      if (retry) throw new Error(`bc:linkUnavailable|cannotConnect|${connector.label(this.describe(sourceId).params)}`, { cause: e });
      throw new Error(`bc:serverError|connection|${(e as Error).message}`, { cause: e });
    } finally {
      if (this.busy === conn) this.busy = outer;
    }
  }

  /** R12 (Stop): the connection with a call in flight sends its cancel; true when a statement was running. The call then
   *  rejects bc:cancelled through `run`. */
  async interrupt(): Promise<boolean> {
    return (await this.busy?.cancel().catch(() => false)) ?? false;
  }

  /** The keys of the front-end's server sources (each once). */
  keys(): string[] {
    return [...new Set(this.described().map((d) => d.key))];
  }

  /** The sources (id), then the pass-through servers (id null) whose key no source has. */
  private described(): ({ id: string | null } & ReturnType<RemoteSources['describe']>)[] {
    const out: ({ id: string | null } & ReturnType<RemoteSources['describe']>)[] = [];
    for (const s of sourceRows(this.front())) {
      if (!isServerKind(s.kind)) continue;
      try { out.push({ id: s.id, ...this.describe(s.id) }); } catch { /* unsupportedKind: no key to log in with */ }
    }
    for (const pt of this.passThroughs()) {
      const connector = isServerKind(pt.kind) ? this.connectors[pt.kind] : undefined;
      try {
        const params = connector?.params(pt.params);
        if (connector && params !== undefined && !out.some((d) => d.key === connector.key(params))) {
          out.push({ id: null, connector, params, key: connector.key(params), label: connector.label(params) });
        }
      } catch { /* unreadable params: no key */ }
    }
    return out;
  }
  /** The first source of `key`; bc:invalidArgument when the front-end has none. */
  private first(key: string) {
    const d = this.described().find((x) => x.key === key);
    if (!d) throw new Error('bc:invalidArgument');
    return d;
  }

  /** The login dialog's defaults: the source's `user` param (the designer's) and its label. */
  loginDefaults(key: string): { user: string; label: string } {
    const { params, label } = this.first(key);
    const user = (params as { user?: unknown }).user;
    return { user: typeof user === 'string' ? user : '', label };
  }

  /** R10: connects the first source of `key` with `c` (the key's open connections are closed first: they used the previous
   *  login); false, and `c` forgotten, when the server refuses it. Other connect failures reject as `connection()` does. */
  async login(key: string, c: Credentials): Promise<boolean> {
    const { id, connector, params } = this.first(key);
    for (const d of this.described()) if (d.key === key && d.id !== null) await this.drop(d.id);
    this.credentials.set(key, c);
    this.typed.delete(key);
    try {
      if (id === null) await this.probe(connector, params, null, async () => {}); // a server no link uses: checked, then closed
      else await this.connection(id);
      this.typed.add(key);
      return true;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('bc:linkUnavailable|needsLogin|')) return false;
      throw e;
    }
  }

  /** A table of `sourceId` named by the server (a refusal's referencing table) by its link name in this front-end; the server's
   *  name when no single link of the source reads it. */
  linkName(sourceId: string, remote: string): string {
    const named = linkRows(this.front()).filter((l) => l.sourceId === sourceId && l.remote === remote);
    return named.length === 1 ? named[0]!.name : remote;
  }

  hasOpen(): boolean { return this.open.size > 0; }

  /** Closes the connection of `sourceId`, if open (a source deleted, or a lost connection). */
  async drop(sourceId: string): Promise<void> {
    const o = this.open.get(sourceId);
    this.open.delete(sourceId);
    try { await (await o)?.conn.close(); } catch { /* already gone, or never opened */ }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.open.keys()].map((id) => this.drop(id)));
  }
}
