// A fake of the in-Resolve bridge for the Node tests: polls `<stateDir>/next.lua`, parses the
// exact request text the server writes, and answers by rewriting a Fusion.prefs in Fusion's
// on-disk format (tabs, hash-like key order, trailing commas, hostile values in unrelated keys)
// via tmp + rename, so every save is a new inode, like Resolve's. It reproduces the bridge
// behaviours the server can observe (id de-duplication, one save for stop with state "stopped",
// error envelopes with result null and prints) and offers failure modes for the protocol tests.
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { retryTransient } from '../../src/protocol.js';

export const BRIDGE_TAG = 'resolve_mcp_bridge v0.2.0';

export interface ParsedRequest {
  v: number;
  id: string;
  session: string;
  op: string;
  ts: number;
  max_kb: number;
  code?: string;
}

/** Parse the request file the server writes (formatRequest in src/lua.ts). */
export function parseRequestFile(text: string): ParsedRequest {
  const field = (name: string): string | undefined => {
    const m = new RegExp(`^  ${name} = (.*?),$`, 'm').exec(text);
    return m?.[1];
  };
  const unquote = (s: string | undefined): string | undefined => {
    if (s === undefined) return undefined;
    if (!s.startsWith('"') || !s.endsWith('"')) throw new Error(`not a quoted Lua string: ${s}`);
    return s.slice(1, -1).replace(/\\(\d{3}|.)/g, (_m, g: string) => {
      if (/^\d{3}$/.test(g)) return String.fromCharCode(Number(g));
      return { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' }[g] ?? g;
    });
  };
  const codeMatch = /^  code = \[(=*)\[\n([\s\S]*?)\]\1\],\n/m.exec(text);
  const out: ParsedRequest = {
    v: Number(field('v')),
    id: unquote(field('id')) ?? '',
    session: unquote(field('session')) ?? '',
    op: unquote(field('op')) ?? '',
    ts: Number(field('ts')),
    max_kb: Number(field('max_kb')),
  };
  if (codeMatch) out.code = codeMatch[2] ?? '';
  return out;
}

export interface FakeResponse {
  ok: boolean;
  result?: unknown;
  error?: unknown;
  prints?: string[];
  ms?: number;
  truncated?: boolean;
  result_bytes?: number;
  prints_dropped?: number;
  extra_returns?: number;
}

export type Responder = (req: ParsedRequest) => FakeResponse | Promise<FakeResponse>;

export type FakeMode = 'normal' | 'silent' | 'late' | 'garbage_hex' | 'garbage_json' | 'half_written' | 'wrong_id';

export interface FakeBridgeOptions {
  stateDir: string;
  prefsDir: string;
  session?: string;
  pid?: number;
  state?: 'running' | 'stopped' | 'error';
  error?: string;
  responder?: Responder;
  /** Delay before answering (ms). */
  delayMs?: number;
  mode?: FakeMode;
  /** For mode 'late': answer this long after the request appeared. */
  lateMs?: number;
  profile?: string;
  pollMs?: number;
  /** The bridge's own idea of its state dir, written into RLBSession. */
  bridgeStateDir?: string;
}

export interface FakeBridge {
  readonly session: string;
  readonly prefsPath: string;
  readonly requests: ParsedRequest[];
  /** Rewrite the prefs file with the current session record (and no response). */
  writeSession(state?: 'running' | 'stopped' | 'error', extra?: Record<string, unknown>): Promise<void>;
  /** Write a raw RLBResp value (tests for malformed bodies). */
  writeRaw(respValue: string, opts?: { unterminated?: boolean }): Promise<void>;
  stop(): void;
}

export function hex(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex');
}

function sortedJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) if (obj[k] !== undefined) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

/** Fusion's string escaping on disk: only `\"`, `\\` and `\n`; tabs and UTF-8 stay raw. */
function luaStr(s: string): string {
  return `"${s.replace(/[\\"\n]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n' })[c] ?? c)}"`;
}

/** A Fusion.prefs body in Fusion's format with our keys in a hash-like order. */
export function renderPrefs(values: Record<string, string>, opts: { unterminated?: boolean } = {}): string {
  const keys = ['RLBDiagPrev', 'RLBRespX', 'RLBSession', 'RLBProbeEsc', 'RLBResp', 'RLBDiag', 'RLBMem'];
  const all: Record<string, string> = {
    RLBDiagPrev: '',
    RLBRespX: 'near:6d697373',
    RLBProbeEsc: 'plus+slash/eq= dq" sq\' bs\\ nl\n tab\t brackets]] dashes-- utf8 é 日本 end',
    RLBDiag: '7b7d',
    RLBMem: 'r2:pid54049:41262d6a-3b88-4c8f-8f50-7f0a1063a4dc',
    ...values,
  };
  const lines = keys.map((k, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (opts.unterminated && k === 'RLBResp') return `\t\t\t${k} = "${all[k] ?? ''}`;
    return `\t\t\t${k} = ${luaStr(all[k] ?? '')}${comma}`;
  });
  return [
    '{',
    '\tVersion = {',
    '\t\t21,',
    '\t\t1,',
    '\t},',
    '\tGlobal = {',
    '\t\tConsole = {',
    '\t\t\tWarningsAsErrors = false,',
    '\t\t\tMaxHistory = 100,',
    '\t\t},',
    '\t\tResolveLuaBridge = {',
    ...lines,
    '\t\t},',
    '\t\tScript = {',
    '\t\t\tAllowAutomaticScripts = 0,',
    '\t\t},',
    '\t},',
    '}',
    '',
  ].join('\n');
}

export function envelopeJson(req: ParsedRequest, session: string, r: FakeResponse): string {
  const env: Record<string, unknown> = { v: 1, id: req.id, session, op: req.op, ok: r.ok };
  if (r.ms !== undefined) env['ms'] = r.ms;
  if (r.truncated) env['truncated'] = true;
  if (r.result_bytes !== undefined) env['result_bytes'] = r.result_bytes;
  if (r.prints_dropped !== undefined) env['prints_dropped'] = r.prints_dropped;
  if (r.extra_returns !== undefined) env['extra_returns'] = r.extra_returns;
  if (r.error !== undefined) env['error'] = r.error;
  if (r.prints !== undefined) env['prints'] = r.prints;
  env['result'] = r.result === undefined ? null : r.result;
  env['bridge'] = BRIDGE_TAG;
  return JSON.stringify(env);
}

export async function startFakeBridge(opts: FakeBridgeOptions): Promise<FakeBridge> {
  const session = opts.session ?? 'fake-session-1234';
  const pid = opts.pid ?? process.pid;
  const mode = opts.mode ?? 'normal';
  const profileDir = path.join(opts.prefsDir, opts.profile ?? 'Default');
  await fsp.mkdir(profileDir, { recursive: true });
  const prefsPath = path.join(profileDir, 'Fusion.prefs');
  const requestPath = path.join(opts.stateDir, 'next.lua');
  const started = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const requests: ParsedRequest[] = [];
  let state: 'running' | 'stopped' | 'error' = opts.state ?? 'running';
  let lastResp = '';
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let busy = false;

  const responder: Responder =
    opts.responder ??
    ((req) => {
      if (req.op === 'ping') {
        return {
          ok: true,
          result: { ok: true, product: 'DaVinci Resolve', version: '21.1.0.17', pid, session, state_dir: opts.bridgeStateDir ?? opts.stateDir, uptime_s: 1, bridge: BRIDGE_TAG, session_saved: true, start_save: { ok: true, attempts: 1, ms: 2 } },
        };
      }
      if (req.op === 'stop') return { ok: true, result: { ok: true, session } };
      return { ok: true, result: { ok: true, echo: req.code }, prints: [], ms: 1 };
    });

  const sessionHex = (st: string, extra: Record<string, unknown> = {}): string =>
    hex(
      sortedJson({
        v: 1,
        session,
        pid,
        started,
        product: 'DaVinci Resolve',
        version: '21.1.0.17',
        profile: `${profileDir}/`,
        state: st,
        bridge: BRIDGE_TAG,
        state_dir: opts.bridgeStateDir ?? opts.stateDir,
        state_dir_source: 'stamp',
        ...(st === 'error' ? { error: opts.error ?? 'fake start failure' } : {}),
        ...extra,
      }),
    );

  async function writeFile(values: Record<string, string>, renderOpts: { unterminated?: boolean } = {}): Promise<void> {
    const tmp = `${prefsPath}.tmp${process.pid}`;
    await fsp.writeFile(tmp, renderPrefs(values, renderOpts), 'utf8');
    // Node holds Fusion.prefs open with share-delete, so the replace normally succeeds on Windows; an AV scanner does not.
    await retryTransient(() => fsp.rename(tmp, prefsPath), { delayMs: 10 });
  }

  const writeSession = async (st: 'running' | 'stopped' | 'error' = state, extra: Record<string, unknown> = {}): Promise<void> => {
    state = st;
    await writeFile({ RLBSession: sessionHex(st, extra), RLBResp: lastResp });
  };

  const writeRaw = async (respValue: string, renderOpts: { unterminated?: boolean } = {}): Promise<void> => {
    lastResp = respValue;
    await writeFile({ RLBSession: sessionHex(state), RLBResp: respValue }, renderOpts);
  };

  async function answer(req: ParsedRequest): Promise<void> {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const r = await responder(req);
    const body = envelopeJson(req, session, r);
    const value = `${req.id}:${hex(body)}`;
    switch (mode) {
      case 'garbage_hex':
        await writeRaw(`${req.id}:zz${hex(body).slice(2)}`);
        return;
      case 'garbage_json':
        await writeRaw(`${req.id}:${hex('{"v":1,"id":')}`);
        return;
      case 'wrong_id':
        await writeRaw(`other${req.id.slice(5)}:${hex(body)}`);
        await new Promise((r2) => setTimeout(r2, 40));
        await writeRaw(value);
        return;
      case 'half_written':
        await writeRaw(value, { unterminated: true });
        await new Promise((r2) => setTimeout(r2, 60));
        await writeRaw(value);
        return;
      default:
        break;
    }
    if (req.op === 'stop') {
      // One save carries the response and the stopped session record (bridge lines 470-478).
      lastResp = value;
      state = 'stopped';
      await writeFile({ RLBSession: sessionHex('stopped', { stopped: Math.floor(Date.now() / 1000) }), RLBResp: value });
      stopped = true;
      return;
    }
    await writeRaw(value);
  }

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      let text: string;
      try {
        text = await fsp.readFile(requestPath, 'utf8');
      } catch {
        return;
      }
      let req: ParsedRequest;
      try {
        req = parseRequestFile(text);
      } catch {
        return;
      }
      if (!req.id || seen.has(req.id)) return; // the bridge ignores a repeated id forever
      seen.add(req.id);
      requests.push(req);
      if (mode === 'silent') return;
      if (mode === 'late') {
        setTimeout(() => {
          void answer(req);
        }, opts.lateMs ?? 300);
        return;
      }
      await answer(req);
    } finally {
      busy = false;
    }
  }

  await writeSession(state);
  timer = setInterval(() => {
    void tick();
  }, opts.pollMs ?? 10);

  return {
    session,
    prefsPath,
    requests,
    writeSession,
    writeRaw,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
