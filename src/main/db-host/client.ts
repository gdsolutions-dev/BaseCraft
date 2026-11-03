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
/** An idle data process answers an interrupt in well under a millisecond; one running a local (synchronous) query never
 *  reads it before the query ends, and Stop then kills it as before C4 (an unanswered interrupt only falls back to the kill).
 *  ponytail: every local Stop waits these 250 ms; db-host posting remote-run start/end events would let the main process
 *  interrupt only while a server call runs. */
const INTERRUPT_ANSWER_MS = 250;
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
  private headMoved: (() => void)[] = []; // whenExecuting's and settles' waiters
  /** interrupt()s sent and not answered: outside `pending`, so their reply never calls sendHead() (F20). */
  private readonly interrupts = new Map<number, (v: boolean) => void>();
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
        // the content state is the main process's (ipc.ts): kept across the data process's own state changes
        if (m.event === 'stateChanged') this.state = { ...m.state, ...(this.state?.content ? { content: this.state.content } : {}) };
        onEvent(m);
        return;
      }
      const stop = this.interrupts.get(m.id);
      if (stop) { stop(m.ok && m.value === true); return; }
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
        for (const stop of [...this.interrupts.values()]) stop(false);
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

  /**
   * Out of the one-call-in-flight rule: answered by the data process at once, never touching the session's data (R12). True
   * when a remote statement was running and its cancel was sent. False when nothing remote runs, the process has exited, or
   * it has not answered within INTERRUPT_ANSWER_MS: a data process busy in SQLite (synchronous) cannot read the message.
   */
  interrupt(): Promise<boolean> {
    if (this.exitCode !== null) return Promise.resolve(false);
    const id = this.next++;
    return new Promise((resolve) => {
      const done = (v: boolean) => { clearTimeout(timer); this.interrupts.delete(id); resolve(v); };
      const timer = setTimeout(() => done(false), INTERRUPT_ANSWER_MS);
      this.interrupts.set(id, done);
      try { this.child.postMessage({ id, method: 'interrupt', args: [] } satisfies HostRequest); } catch { done(false); }
    });
  }

  /** The call `id` has answered (either way) within `ms`. */
  settles(id: number, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.pending.has(id)) { this.headMoved.push(check); return; }
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.headMoved = this.headMoved.filter((f) => f !== check);
        resolve(!this.pending.has(id));
      }, ms);
      check();
    });
  }

  /**
   * Stop of the executing call `id` (cancelCall, R12): its server statement is cancelled first (interrupt), and the process
   * lives on if the call settles within `waitMs`. Otherwise the kill, unless the call answered meanwhile or `current()` (the
   * caller still holds this host) is false. That check runs in the kill's own tick: once `id` has answered, sendHead() may
   * have sent the next call (a row save), which a kill would end after it committed. Resolves true once killed.
   */
  async stop(id: number, waitMs: number, current: () => boolean = () => true): Promise<boolean> {
    if (await this.interrupt() && await this.settles(id, waitMs)) return false;
    if (!current() || !this.isExecuting(id)) return false;
    await this.kill();
    return true;
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
