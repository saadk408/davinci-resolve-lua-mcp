// The server side of protocol v1: the single-instance lock, the
// in-process mutex, the request slot `next.lua`, the prefs poller and the liveness checks.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { formatRequest, SESSION_RE, type RequestOp } from './lua.js';
import {
  extractResp,
  extractSessionHex,
  findPrefsFile,
  parseEnvelope,
  parseSession,
  type Envelope,
  type Session,
} from './prefs.js';

export const START_INSTRUCTION =
  'in Resolve open a project and run Workspace > Scripts > resolve_mcp_bridge, then retry';

export type BridgeErrorKind =
  | 'lock_held'
  | 'prefs_missing'
  | 'never_started'
  | 'stopped'
  | 'bridge_error'
  | 'resolve_gone'
  | 'timeout'
  | 'bad_response'
  | 'io_error';

export class BridgeError extends Error {
  constructor(
    public readonly kind: BridgeErrorKind,
    message: string,
    public readonly nextStep: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BridgeError';
  }

  /** One line for an isError result: what failed, then what to do. */
  get text(): string {
    return `${this.message}: ${this.nextStep}`;
  }
}

export interface RequestOptions {
  code?: string | undefined;
  timeoutMs: number;
}

export type StatusReason =
  | 'never_started'
  | 'stopped'
  | 'resolve_gone'
  | 'no_reply'
  | 'bridge_error'
  | 'prefs_missing'
  | 'lock_held';

/** `owned` is true only while this process is inside a request; `holder_pid` is another live process inside one. */
export interface LockStatus {
  path: string;
  owned: boolean;
  holder_pid?: number;
}

export interface BridgeStatus {
  alive: boolean;
  reason?: StatusReason;
  detail?: string;
  prefs_file?: string;
  prefs_mtime?: string;
  session?: Session;
  pid_alive?: boolean;
  ping?: unknown;
  ping_ms?: number;
  lock: LockStatus;
  state_dir: string;
  state_dir_match?: boolean;
}

/** What server.ts depends on; BridgeClient in production, a recording stub in the tool tests. */
export interface Bridge {
  request(op: RequestOp, opts: RequestOptions): Promise<Envelope>;
  status(): Promise<BridgeStatus>;
}

export interface BridgeClientOptions {
  stateDir: string;
  prefsDir: string;
  maxResponseKb: number;
  logger?: Logger | undefined;
  /** Poll interval for the prefs file (default 25 ms). */
  pollMs?: number | undefined;
  /** Ping timeout used by status() (default 2000 ms). */
  pingTimeoutMs?: number | undefined;
  pid?: number | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  isPidAlive?: ((pid: number) => boolean) | undefined;
}

export const REQUEST_FILE = 'next.lua';
export const REQUEST_TMP_FILE = 'next.lua.tmp';
export const LOCK_FILE = 'lock';
export const FORCED_READ_EVERY = 20;
/** How often a request re-tries a lock held by another live server (ms). */
const LOCK_POLL_MS = 50;

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

interface PollKey {
  ino: number;
  size: number;
  mtimeMs: number;
}

function pollKey(st: fs.Stats): PollKey {
  return { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
}

function sameKey(a: PollKey | undefined, b: PollKey): boolean {
  return a !== undefined && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

export class BridgeClient implements Bridge {
  readonly stateDir: string;
  readonly prefsDir: string;
  readonly lockPath: string;
  readonly requestPath: string;
  private readonly tmpPath: string;
  private readonly maxResponseKb: number;
  private readonly log: Logger;
  private readonly pollMs: number;
  private readonly pingTimeoutMs: number;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isPidAlive: (pid: number) => boolean;
  private chain: Promise<unknown> = Promise.resolve();
  private lockOwned = false;
  private lockHolder: number | undefined;
  private lockProblem: string | undefined;

  constructor(opts: BridgeClientOptions) {
    this.stateDir = opts.stateDir;
    this.prefsDir = opts.prefsDir;
    this.lockPath = path.join(opts.stateDir, LOCK_FILE);
    this.requestPath = path.join(opts.stateDir, REQUEST_FILE);
    this.tmpPath = path.join(opts.stateDir, REQUEST_TMP_FILE);
    this.maxResponseKb = opts.maxResponseKb;
    this.log = opts.logger ?? silentLogger;
    this.pollMs = opts.pollMs ?? 25;
    this.pingTimeoutMs = opts.pingTimeoutMs ?? 2000;
    this.pid = opts.pid ?? process.pid;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => sleepFor(ms));
    this.isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  }

  get lock(): LockStatus {
    const out: LockStatus = { path: this.lockPath, owned: this.lockOwned };
    if (!this.lockOwned && this.lockHolder !== undefined) out.holder_pid = this.lockHolder;
    return out;
  }

  // ---- lock -------------------------------------------------------------------------------

  /**
   * Take `<stateDir>/lock` (a hard link of a pid file, so it always holds our pid) for one request. The lock is held
   * only while a request is in flight, never while idle: Claude Desktop keeps an idle "era probe"
   * sibling of the server alive for the whole session, so a lock taken at startup would sit with
   * that sibling for ever (measured 2026-09-21). A dead holder is taken over by renaming the stale
   * file away first, so two servers racing on the same dead lock cannot both win; a live holder is
   * waited for up to `waitMs`. Returns true when we own the lock.
   */
  async acquireLock(waitMs = 0): Promise<boolean> {
    const deadline = this.now() + waitMs;
    for (;;) {
      const r = await this.tryLock();
      if (r !== 'held') return r === 'owned';
      const left = deadline - this.now();
      if (left <= 0) return false;
      await this.sleep(Math.min(LOCK_POLL_MS, left));
    }
  }

  /**
   * One pass over the lock file: owned, held by a live pid, or a file-system problem. The lock is
   * created by hard-linking a pid file into place: `link` fails with EEXIST when the lock exists and
   * the new file already holds our pid, so no reader can ever see an empty lock and mistake a live
   * owner for a stale one (an `open(wx)` + write pair had that window, and two racing servers could
   * both end up owning the slot).
   */
  private async tryLock(): Promise<'owned' | 'held' | 'error'> {
    if (this.lockOwned) return 'owned';
    const pidFile = `${this.lockPath}.${this.pid}.pid`;
    try {
      await fsp.writeFile(pidFile, `${this.pid}\n`);
    } catch (err) {
      this.log.warn('lock: cannot write the pid file', err);
      this.lockProblem = (err as Error).message;
      return 'error';
    }
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await fsp.link(pidFile, this.lockPath);
          this.lockOwned = true;
          this.lockHolder = undefined;
          this.lockProblem = undefined;
          this.log.debug('lock acquired', { path: this.lockPath });
          return 'owned';
        } catch (err) {
          if (errnoCode(err) !== 'EEXIST') {
            this.log.warn('lock: cannot create', err);
            this.lockOwned = false;
            this.lockProblem = (err as Error).message;
            return 'error';
          }
        }
        const holder = await this.readLockPid();
        if (holder === this.pid) {
          this.lockOwned = true;
          this.lockHolder = undefined;
          return 'owned';
        }
        if (holder !== undefined && this.isPidAlive(holder)) {
          this.lockOwned = false;
          this.lockHolder = holder;
          return 'held';
        }
        // Dead (or unreadable) holder: exactly one process wins the rename.
        const stale = `${this.lockPath}.stale.${this.pid}`;
        try {
          await fsp.rename(this.lockPath, stale);
          await fsp.unlink(stale).catch(() => undefined);
          this.log.info('lock: took over a stale lock', { holder });
        } catch (err) {
          if (errnoCode(err) !== 'ENOENT') {
            this.log.warn('lock: cannot take over', err);
            this.lockOwned = false;
            this.lockProblem = (err as Error).message;
            return 'error';
          }
        }
      }
      this.lockOwned = false;
      this.lockProblem = 'the lock file kept changing under us';
      return 'error';
    } finally {
      await fsp.unlink(pidFile).catch(() => undefined);
    }
  }

  private async readLockPid(): Promise<number | undefined> {
    try {
      const text = await fsp.readFile(this.lockPath, 'utf8');
      const n = Number.parseInt(text.trim(), 10);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    } catch {
      return undefined;
    }
  }

  /** Release the lock if the file still holds our pid. Safe to call from process 'exit'. */
  releaseLockSync(): void {
    if (!this.lockOwned) return;
    this.lockOwned = false;
    try {
      const text = fs.readFileSync(this.lockPath, 'utf8');
      if (Number.parseInt(text.trim(), 10) === this.pid) fs.unlinkSync(this.lockPath);
    } catch {
      // already gone
    }
  }

  private async ensureLock(waitMs: number): Promise<void> {
    if (await this.acquireLock(waitMs)) return;
    const holder = this.lockHolder;
    if (holder === undefined) {
      throw new BridgeError(
        'lock_held',
        `cannot take the request slot lock ${this.lockPath} (${this.lockProblem ?? 'unknown problem'})`,
        'check that RLB_STATE_DIR is writable, or point RLB_STATE_DIR elsewhere',
        { lock: this.lockPath },
      );
    }
    throw new BridgeError(
      'lock_held',
      `another server (pid ${holder}) kept the request slot lock ${this.lockPath} for more than ${(waitMs / 1000).toFixed(1)} s`,
      'it may be running a long chunk: wait, then retry; if it persists, stop the other davinci-resolve-lua-mcp server (a second Claude Desktop entry, make smoke or a dev-register loop) or point RLB_STATE_DIR elsewhere; remove the lock file by hand if the pid is not a server',
      { lock: this.lockPath, holder_pid: holder, waited_ms: waitMs },
    );
  }

  /** The lock as it is on disk right now: a live holder's pid, or none (a stale file counts as free). */
  async inspectLock(): Promise<LockStatus> {
    const out: LockStatus = { path: this.lockPath, owned: this.lockOwned };
    if (this.lockOwned) return out;
    const holder = await this.readLockPid();
    if (holder !== undefined && holder !== this.pid && this.isPidAlive(holder)) out.holder_pid = holder;
    return out;
  }

  /**
   * Startup hygiene, lock owner only: a request file left by an earlier server (or the sandbox
   * diagnostic) would make a bridge launched later pre-seed its `last_id` from it.
   */
  async removeStaleRequest(): Promise<boolean> {
    if (!this.lockOwned) return false;
    let removed = false;
    for (const p of [this.requestPath, this.tmpPath]) {
      try {
        await fsp.unlink(p);
        removed = true;
        this.log.info('removed a leftover request file', { path: p });
      } catch (err) {
        if (errnoCode(err) !== 'ENOENT') this.log.warn('cannot remove leftover request file', err);
      }
    }
    return removed;
  }

  // ---- session ------------------------------------------------------------------------------

  private async locatePrefs(): Promise<{ path: string; mtimeMs: number }> {
    const found = await findPrefsFile(this.prefsDir);
    if (!found) {
      throw new BridgeError(
        'prefs_missing',
        `no Fusion.prefs under ${this.prefsDir}`,
        'check that DaVinci Resolve has been launched at least once on this Mac, or set RLB_PREFS_DIR to its Fusion/Profiles folder',
        { prefs_dir: this.prefsDir },
      );
    }
    return found;
  }

  /** Parse RLBSession out of the prefs text; undefined when the bridge never wrote one. */
  private readSession(text: string): Session | undefined {
    const hex = extractSessionHex(text);
    if (hex === undefined || hex === '') return undefined;
    try {
      return parseSession(hex);
    } catch (err) {
      throw new BridgeError(
        'bridge_error',
        `RLBSession in Fusion.prefs is unreadable (${(err as Error).message})`,
        START_INSTRUCTION,
      );
    }
  }

  /** Throw the BridgeError that describes why `op` cannot be sent, or return the live session. */
  private requireRunning(session: Session | undefined, op: RequestOp): Session {
    if (!session) {
      throw new BridgeError('never_started', 'bridge not running (never started)', START_INSTRUCTION);
    }
    if (session.state === 'stopped') {
      const when = session.stopped ? ` at ${new Date(session.stopped * 1000).toISOString()}` : '';
      throw new BridgeError(
        'stopped',
        `bridge not running (stopped${when})`,
        START_INSTRUCTION,
        { session: session.session },
      );
    }
    if (session.state === 'error') {
      throw new BridgeError(
        'bridge_error',
        `the bridge failed to start: ${session.error ?? 'no detail'}`,
        `fix the cause, then ${START_INSTRUCTION}`,
        { session: session.session },
      );
    }
    if (session.pid !== undefined && session.pid > 0 && !this.isPidAlive(session.pid)) {
      throw new BridgeError(
        'resolve_gone',
        `bridge not running (Resolve pid ${session.pid} is gone)`,
        START_INSTRUCTION,
        { pid: session.pid, op },
      );
    }
    if (!SESSION_RE.test(session.session) || session.session === '*') {
      throw new BridgeError(
        'bridge_error',
        `RLBSession holds an unusable session token ${JSON.stringify(session.session)}`,
        START_INSTRUCTION,
      );
    }
    return session;
  }

  // ---- requests -------------------------------------------------------------------------------

  private withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  request(op: RequestOp, opts: RequestOptions): Promise<Envelope> {
    return this.withMutex(() => this.requestLocked(op, opts));
  }

  ping(timeoutMs: number = this.pingTimeoutMs): Promise<Envelope> {
    return this.request('ping', { timeoutMs });
  }

  run(code: string, timeoutMs: number): Promise<Envelope> {
    return this.request('run', { code, timeoutMs });
  }

  stop(timeoutMs: number = this.pingTimeoutMs): Promise<Envelope> {
    return this.request('stop', { timeoutMs });
  }

  private async requestLocked(op: RequestOp, opts: RequestOptions): Promise<Envelope> {
    const entry = this.now();
    await this.ensureLock(opts.timeoutMs);
    try {
      return await this.exchange(op, opts, entry);
    } finally {
      this.releaseLockSync();
    }
  }

  /** The request/response exchange proper; the caller holds the lock and releases it afterwards. */
  private async exchange(op: RequestOp, opts: RequestOptions, entry: number): Promise<Envelope> {
    const prefs = await this.locatePrefs();
    const text = await this.readText(prefs.path);
    // Read fresh every time: a stale session id sent to a live bridge makes that bridge exit.
    const session = this.requireRunning(this.readSession(text), op);

    // Baseline before the request exists: a bridge tick plus a 1 to 6 ms save can land before a
    // baseline taken afterwards, which would hide the response until an unrelated save.
    let last: PollKey | undefined;
    try {
      last = pollKey(await fsp.stat(prefs.path));
    } catch {
      last = undefined;
    }

    const id = randomUUID().replace(/-/g, '');
    const body = formatRequest({
      id,
      session: op === 'run' ? session.session : '*',
      op,
      ts: Math.floor(this.now() / 1000),
      maxKb: this.maxResponseKb,
      code: opts.code,
    });
    try {
      await fsp.writeFile(this.tmpPath, body, 'utf8');
      await fsp.rename(this.tmpPath, this.requestPath);
    } catch (err) {
      await fsp.unlink(this.tmpPath).catch(() => undefined);
      throw new BridgeError(
        'io_error',
        `cannot write the request file ${this.requestPath} (${(err as Error).message})`,
        'check that RLB_STATE_DIR is writable',
        { id },
      );
    }
    this.log.debug('request written', { id, op, bytes: body.length });

    const started = this.now();
    const deadline = entry + opts.timeoutMs; // the wait for the lock counts against the same budget
    let polls = 0;
    try {
      for (;;) {
        await this.sleep(this.pollMs);
        polls += 1;
        let st: fs.Stats | undefined;
        try {
          st = await fsp.stat(prefs.path);
        } catch {
          st = undefined; // mid-rename; try again next tick
        }
        const key = st ? pollKey(st) : undefined;
        const changed = key !== undefined && !sameKey(last, key);
        if (changed || polls % FORCED_READ_EVERY === 0) {
          if (key) last = key;
          const resp = extractResp(await this.readText(prefs.path));
          if (resp && resp.id === id) {
            let env: Envelope;
            try {
              env = parseEnvelope(resp.hex);
            } catch (err) {
              throw new BridgeError(
                'bad_response',
                `the bridge answered request ${id} with a body the server cannot decode (${(err as Error).message})`,
                'retry; if it repeats, the installed bridge script and this server disagree on the protocol: restart Claude Desktop so the server reinstalls the script, then relaunch it from the Scripts menu',
                { id },
              );
            }
            if (env.session !== session.session && env.session !== '') {
              this.log.warn('response session differs from the request session', { id, sent: session.session, got: env.session });
            }
            this.log.debug('response received', { id, op, ok: env.ok, ms: this.now() - started });
            return env;
          }
        }
        if (this.now() >= deadline) {
          throw new BridgeError(
            'timeout',
            `the bridge did not answer request ${id} within ${((this.now() - started) / 1000).toFixed(1)} s`,
            `either the bridge is busy on a long synchronous call (wait, then retry), or its loop is gone (${START_INSTRUCTION})`,
            { id, op, timeout_ms: opts.timeoutMs },
          );
        }
      }
    } finally {
      // The bridge cannot delete files; a slot that stays occupied is never re-run (same id).
      await fsp.unlink(this.requestPath).catch(() => undefined);
    }
  }

  private async readText(p: string): Promise<string> {
    try {
      return await fsp.readFile(p, 'utf8');
    } catch (err) {
      throw new BridgeError(
        'io_error',
        `cannot read ${p} (${(err as Error).message})`,
        'check the file permissions of Fusion.prefs',
      );
    }
  }

  // ---- status ---------------------------------------------------------------------------------

  /** Never throws; every failure becomes a reason. Used by resolve_status. */
  async status(): Promise<BridgeStatus> {
    const out: BridgeStatus = { alive: false, lock: this.lock, state_dir: this.stateDir };
    try {
      out.lock = await this.inspectLock();
      const prefs = await this.locatePrefs();
      out.prefs_file = prefs.path;
      out.prefs_mtime = new Date(prefs.mtimeMs).toISOString();
      const text = await this.readText(prefs.path);
      const session = this.readSession(text);
      if (session) {
        out.session = session;
        if (session.pid !== undefined && session.pid > 0) out.pid_alive = this.isPidAlive(session.pid);
        if (session.state_dir !== undefined) {
          out.state_dir_match = stripSlash(session.state_dir) === stripSlash(this.stateDir);
        }
      }
      this.requireRunning(session, 'ping');
      const t0 = this.now();
      try {
        const env = await this.ping();
        out.ping = env.result;
        out.ping_ms = this.now() - t0;
        out.alive = env.ok;
        if (!env.ok) {
          out.reason = 'bridge_error';
          out.detail = typeof env.error === 'string' ? env.error : JSON.stringify(env.error);
        }
      } catch (err) {
        if (err instanceof BridgeError && err.kind === 'timeout') {
          out.reason = 'no_reply';
          out.detail = err.text;
        } else {
          throw err;
        }
      }
    } catch (err) {
      out.lock = this.lock;
      if (err instanceof BridgeError) {
        out.reason = kindToReason(err.kind);
        out.detail = err.text;
      } else {
        out.reason = 'bridge_error';
        out.detail = (err as Error).message;
      }
    }
    return out;
  }
}

function stripSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

function kindToReason(kind: BridgeErrorKind): StatusReason {
  switch (kind) {
    case 'lock_held':
    case 'prefs_missing':
    case 'never_started':
    case 'stopped':
    case 'resolve_gone':
    case 'bridge_error':
      return kind;
    case 'timeout':
      return 'no_reply';
    case 'bad_response':
    case 'io_error':
      return 'bridge_error';
  }
}
