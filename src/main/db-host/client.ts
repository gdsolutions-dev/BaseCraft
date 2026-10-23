// Main-process side of the data process (host.ts): starts it, sends the session's calls, keeps its state. Every session
// method becomes asynchronous; an error comes back with its name and message (`bc:<code>` rejections stay as they were).
import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { SessionState } from '../../shared/api';
import type { Session } from '../session';
import type { HostEvent, HostOpen, HostReply, HostRequest } from './protocol';

export type AsyncSession = { [K in keyof Session]: Session[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/** What DbHost needs of a UtilityProcess (a fake one in client.test.ts). */
type Child = { on(e: 'message', f: (m: HostReply | HostEvent) => void): unknown; once(e: 'exit', f: (code: number) => void): unknown; postMessage(m: HostRequest): void; kill(): boolean };
type Pending = { method: string; args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void };

export class DbHost {
  readonly session: AsyncSession;
  state!: SessionState;
  private next = 1;
  /**
   * The calls in their order of arrival. Only the first one has been sent: the next one leaves when it answers (one call in
   * flight). A reply still in transit therefore means nothing else was sent, so a kill (Stop) can only end the call it
   * targets; the calls behind it never reached the data process and reject bc:cancelled safely. (The data process keeps
   * its own queue as defence in depth.)
   */
  private readonly pending = new Map<number, Pending>();
  private headMoved: (() => void)[] = []; // whenExecuting's waiters
  private ending = false; // close() or kill(): the exit is expected
  private exitCode: number | null = null;
  private readonly exited: Promise<void>;

  /** Starts the data process and opens the base in it (checked or created first; errors reject as `bc:<code>`). */
  static async start(o: HostOpen, onEvent: (e: HostEvent) => void, onExit: (code: number) => void): Promise<{ host: DbHost; state: SessionState }> {
    // ponytail: no heap cap on the data process (UDF memory retention, A3 Task 4 I2); add execArgv: ['--max-old-space-size=…']
    // to this fork if a query can exhaust memory.
    const child = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'BaseCraft data' });
    const host = new DbHost(child, o, onEvent, onExit);
    try {
      host.state = (await host.call('open', [o])) as SessionState;
    } catch (e) {
      await host.kill();
      throw e;
    }
    return { host, state: host.state };
  }

  /** Test seam: a DbHost over a given process. */
  static attach(child: Child, o: HostOpen, onEvent: (e: HostEvent) => void, onExit: (code: number) => void): DbHost {
    return new DbHost(child, o, onEvent, onExit);
  }

  private constructor(private readonly child: Child, readonly opened: HostOpen, onEvent: (e: HostEvent) => void, onExit: (code: number) => void) {
    child.on('message', (m: HostReply | HostEvent) => {
      if ('event' in m) {
        if (m.event === 'stateChanged') this.state = m.state;
        onEvent(m);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(Object.assign(new Error(m.message), { name: m.name }));
      this.sendHead();
    });
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => {
        this.exitCode = code;
        const error = this.ending ? 'bc:cancelled' : 'bc:hostCrashed';
        for (const p of this.pending.values()) p.reject(new Error(error));
        this.pending.clear();
        for (const f of this.headMoved.splice(0)) f();
        if (!this.ending) onExit(code);
        resolve();
      });
    });
    // `then` stays undefined: the proxy must not look like a promise
    this.session = new Proxy({}, {
      get: (_, k) => (typeof k !== 'string' || k === 'then' ? undefined : (...args: unknown[]) => this.call(k, args)),
    }) as AsyncSession;
  }

  private call(method: string, args: unknown[]): Promise<unknown> {
    if (this.exitCode !== null) return Promise.reject(new Error(this.ending ? 'bc:cancelled' : 'bc:hostCrashed'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, args, resolve, reject });
      if (this.pending.size === 1) this.sendHead();
    });
  }

  /** Sends the first pending call (the previous one answered); a message that cannot be sent rejects, and the next goes. */
  private sendHead(): void {
    for (const f of this.headMoved.splice(0)) f();
    const head = this.pending.entries().next().value;
    if (!head) return;
    const [id, p] = head;
    try { this.child.postMessage({ id, method: p.method, args: p.args } satisfies HostRequest); } catch (e) {
      this.pending.delete(id);
      p.reject(e as Error);
      this.sendHead();
    }
  }

  /** The oldest pending call to one of `methods` (the query that Stop ends), or null. */
  pendingCall(methods: ReadonlySet<string>): number | null {
    for (const [id, p] of this.pending) if (methods.has(p.method)) return id;
    return null;
  }

  /** This call is the one sent to the data process (the calls before it have answered). */
  isExecuting(id: number): boolean { return this.pending.keys().next().value === id; }

  /** Resolves true once the call is the one sent (the calls before it finished), false if it ended first. */
  async whenExecuting(id: number): Promise<boolean> {
    while (this.pending.has(id) && !this.isExecuting(id)) await new Promise<void>((r) => this.headMoved.push(r));
    return this.pending.has(id);
  }

  /** Closes the session (database, lock) after the calls already queued, then ends the process; killed after timeoutMs. */
  async close(timeoutMs = 3000): Promise<void> {
    if (this.exitCode !== null) return;
    this.ending = true;
    const timer = setTimeout(() => this.child.kill(), timeoutMs);
    try { await this.call('close', []); } catch (e) { console.error(e); }
    this.child.kill();
    await this.exited;
    clearTimeout(timer);
  }

  /** Ends the process at once: pending calls reject bc:cancelled; SQLite rolls an interrupted write back at the next open.
   *  Resolves once the process has exited (its file handles are released). */
  kill(): Promise<void> {
    this.ending = true;
    if (this.exitCode === null) this.child.kill();
    return this.exited;
  }
}
