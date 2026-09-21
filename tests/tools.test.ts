// The 15 tools through an in-memory MCP client: metadata, result shapes, error mapping and the
// Lua each tool sends (captured by a recording Bridge stub), plus a few end-to-end cases through
// the real BridgeClient and the fake bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { InstallResult } from '../src/bridgeInstall.js';
import { loadConfig } from '../src/config.js';
import { DocsIndex } from '../src/docsSearch.js';
import { silentLogger } from '../src/log.js';
import type { Envelope } from '../src/prefs.js';
import { BridgeClient, BridgeError, START_INSTRUCTION, type Bridge, type BridgeStatus, type RequestOptions } from '../src/protocol.js';
import { createServer, TOOL_NAMES, type ServerDeps } from '../src/server.js';
import type { RequestOp } from '../src/lua.js';
import { BRIDGE_TAG, startFakeBridge } from './helpers/fakeBridge.js';
import { makeTempDirs, type TempDirs } from './helpers/tmp.js';

type Canned = Partial<Envelope> | ((op: RequestOp, opts: RequestOptions) => Partial<Envelope>) | Error;

class StubBridge implements Bridge {
  calls: Array<{ op: RequestOp; opts: RequestOptions }> = [];
  queue: Canned[] = [];
  statusResult: BridgeStatus = { alive: false, reason: 'never_started', detail: 'bridge not running (never started)', lock: { path: '/x/lock', owned: true }, state_dir: '/x' };

  reply(...items: Canned[]): this {
    this.queue.push(...items);
    return this;
  }

  async request(op: RequestOp, opts: RequestOptions): Promise<Envelope> {
    this.calls.push({ op, opts });
    const next = this.queue.shift();
    if (next === undefined) throw new Error(`StubBridge: no canned reply for ${op}`);
    if (next instanceof Error) throw next;
    const partial = typeof next === 'function' ? next(op, opts) : next;
    return { v: 1, id: 'id1', session: 'sess', op, ok: true, bridge: BRIDGE_TAG, result: null, ...partial };
  }

  async status(): Promise<BridgeStatus> {
    return this.statusResult;
  }

  lastCode(): string {
    return this.calls[this.calls.length - 1]?.opts.code ?? '';
  }
}

interface Rig {
  client: Client;
  bridge: StubBridge;
  dirs: TempDirs;
  install: InstallResult;
  close(): Promise<void>;
}

async function rig(bridge: Bridge = new StubBridge(), env: NodeJS.ProcessEnv = {}, extra: Pick<ServerDeps, 'onToolFailure'> = {}): Promise<Rig> {
  const dirs = await makeTempDirs();
  const config = loadConfig({ RLB_STATE_DIR: dirs.stateDir, RLB_PREFS_DIR: dirs.prefsDir, RLB_DOCS_DIR: dirs.docsDir, RLB_SCRIPTS_DIR: dirs.scriptsDir, ...env }, dirs.root);
  const install: InstallResult = { outcome: 'up_to_date', message: 'current', scripts_dir: dirs.scriptsDir, state_dir: dirs.stateDir, files: [], checked_at: 'now' };
  const server = createServer({ config, bridge, docs: new DocsIndex(config.docsDir), install: async () => install, logger: silentLogger, logFile: path.join(dirs.stateDir, 'server.log'), ...extra });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'rlb-test', version: '0.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return {
    client,
    bridge: bridge as StubBridge,
    dirs,
    install,
    close: async () => {
      await client.close();
      await server.close();
      await dirs.cleanup();
    },
  };
}

function structured(r: { structuredContent?: unknown }): Record<string, unknown> {
  return (r.structuredContent ?? {}) as Record<string, unknown>;
}

function text(r: { content: unknown }): string {
  const first = (r.content as Array<{ type: string; text?: string }>)[0];
  return first?.text ?? '';
}

test('tools/list: exactly the 15 tools, each with title, hints and openWorldHint false; instructions present', async () => {
  const r = await rig();
  try {
    const { tools } = await r.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) {
      assert.ok(t.title, `${t.name} has a title`);
      assert.ok((t.description ?? '').length > 60, `${t.name} has a description`);
      assert.ok(t.name.length <= 64);
      const a = t.annotations ?? {};
      assert.equal(a.openWorldHint, false, `${t.name} openWorldHint`);
      assert.equal(typeof a.readOnlyHint, 'boolean', `${t.name} readOnlyHint`);
      assert.equal(typeof a.destructiveHint, 'boolean', `${t.name} destructiveHint`);
      assert.ok(t.outputSchema, `${t.name} has an outputSchema`);
      assert.ok(!/always|you must|never call/i.test(t.description ?? ''), `${t.name} description describes, it does not instruct`);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));
    for (const n of ['resolve_status', 'get_project_info', 'list_projects', 'list_timelines', 'list_media_pool_clips', 'get_timeline_items', 'get_render_status', 'scripting_api_docs']) {
      assert.equal(byName[n]?.readOnlyHint, true, `${n} read-only`);
      assert.equal(byName[n]?.destructiveHint, false);
    }
    for (const n of ['run_lua', 'delete_markers']) assert.equal(byName[n]?.destructiveHint, true, `${n} destructive`);
    for (const n of ['add_marker', 'set_current_timeline', 'open_project', 'render_current_timeline', 'stop_bridge']) {
      assert.equal(byName[n]?.readOnlyHint, false, `${n} write`);
      assert.equal(byName[n]?.destructiveHint, false, `${n} not destructive`);
    }
    const instructions = r.client.getInstructions() ?? '';
    assert.match(instructions, /Workspace > Scripts > resolve_lua_bridge/);
    assert.match(instructions, /scripting_api_docs/);
    assert.match(instructions, /confirm=true/);
    assert.match(instructions, /get_render_status/);
    assert.equal(r.client.getServerVersion()?.name, 'resolve-lua-bridge');
  } finally {
    await r.close();
  }
});

test('resolve_status without a bridge is a normal result that says never started and how to start', async () => {
  const r = await rig();
  try {
    const res = await r.client.callTool({ name: 'resolve_status', arguments: {} });
    assert.notEqual(res.isError, true);
    const s = structured(res);
    assert.equal(s['alive'], false);
    assert.equal(s['reason'], 'never_started');
    assert.equal(s['start_instruction'], START_INSTRUCTION);
    assert.deepEqual(s['config_problems'], []);
    assert.equal((s['bridge_script'] as InstallResult).outcome, 'up_to_date');
    assert.equal((s['server'] as { name: string }).name, 'resolve-lua-bridge');
    assert.ok(text(res).includes('"alive": false'));
    assert.equal(r.bridge.calls.length, 0, 'no run when not alive');
  } finally {
    await r.close();
  }
});

test('resolve_status when alive adds product, edition, page and project from one run', async () => {
  const stub = new StubBridge();
  stub.statusResult = { alive: true, lock: { path: '/x/lock', owned: true }, state_dir: '/x', ping: { product: 'DaVinci Resolve' }, ping_ms: 40 };
  stub.reply({ result: { ok: true, product: 'DaVinci Resolve', version: '21.1.0.17', is_studio: false, current_page: 'edit', project: 'Demo' } });
  const r = await rig(stub);
  try {
    const s = structured(await r.client.callTool({ name: 'resolve_status', arguments: {} }));
    assert.equal(s['alive'], true);
    assert.equal(s['is_studio'], false);
    assert.equal(s['current_page'], 'edit');
    assert.equal(s['project'], 'Demo');
    assert.equal(s['start_instruction'], undefined);
    assert.equal(stub.calls[0]?.op, 'run');
    assert.match(stub.lastCode(), /IsStudio\(\)/);
  } finally {
    await r.close();
  }
});

test('run_lua: success, chunk failure, table error, truncation and bridge errors', async () => {
  const stub = new StubBridge().reply(
    { result: { a: [1, 2] }, prints: ['hi\t1'], ms: 4, extra_returns: 1 },
    { ok: false, error: 'request:1: attempt to index a nil value', prints: ['before'], ms: 1 },
    { ok: false, error: { code: 7 }, prints: [], ms: 1 },
    { result: '{"a":"zzzz', truncated: true, result_bytes: 200_000, prints: [], prints_dropped: 3, ms: 9 },
    new BridgeError('timeout', 'the bridge did not answer request abc within 3.0 s', 'wait, then retry', { id: 'abc' }),
  );
  const r = await rig(stub);
  try {
    const okRes = await r.client.callTool({ name: 'run_lua', arguments: { code: 'return {a={1,2}}', timeout_s: 3 } });
    assert.notEqual(okRes.isError, true);
    const s1 = structured(okRes);
    assert.deepEqual(s1['result'], { a: [1, 2] });
    assert.deepEqual(s1['prints'], ['hi\t1']);
    assert.equal(s1['extra_returns'], 1);
    assert.equal(s1['truncated'], false);
    assert.equal(stub.calls[0]?.opts.timeoutMs, 3000);
    assert.equal(stub.calls[0]?.opts.code, 'return {a={1,2}}');

    const fail = await r.client.callTool({ name: 'run_lua', arguments: { code: 'x.y' } });
    assert.equal(fail.isError, true);
    assert.match(text(fail), /Lua error inside Resolve: request:1: attempt to index a nil value/);
    const s2 = structured(fail);
    assert.equal(s2['ok'], false);
    assert.deepEqual(s2['prints'], ['before']);
    assert.equal(stub.calls[1]?.opts.timeoutMs, 30_000, 'default timeout from config');

    const table = await r.client.callTool({ name: 'run_lua', arguments: { code: 'error({code=7})' } });
    assert.equal(table.isError, true);
    assert.match(text(table), /\{"code":7\}/);

    const big = await r.client.callTool({ name: 'run_lua', arguments: { code: 'big' } });
    assert.notEqual(big.isError, true);
    const s4 = structured(big);
    assert.equal(s4['truncated'], true);
    assert.equal(s4['result'], null);
    assert.equal(s4['result_preview'], '{"a":"zzzz');
    assert.equal(s4['result_bytes'], 200_000);
    assert.equal(s4['prints_dropped'], 3);
    assert.match(text(big), /result JSON is 200000 bytes, the cap is 64 KB/);

    const timeout = await r.client.callTool({ name: 'run_lua', arguments: { code: 'slow' } });
    assert.equal(timeout.isError, true);
    assert.match(text(timeout), /did not answer request abc.*wait, then retry/);
    assert.equal(structured(timeout)['kind'], 'timeout');

    const invalid = await r.client.callTool({ name: 'run_lua', arguments: { code: 'x', timeout_s: 999 } });
    assert.equal(invalid.isError, true, 'schema bounds are enforced');
  } finally {
    await r.close();
  }
});

test('read-only tools shape their results and map Lua-side failures to isError', async () => {
  const stub = new StubBridge().reply(
    { result: { ok: true, name: 'Demo', unique_id: 'u1', timeline_count: 2, database: { DbType: 'Disk', DbName: 'Local Database' }, frame_rate: 23.976 } },
    { result: { ok: true, folder: 'root', current: 'Demo', projects: {} } },
    { result: { ok: true, current_unique_id: 't1', timeline_count: 0, timelines: {} } },
    { result: { ok: true, bin_path: '/Footage', bin_unique_id: 'b1', total: 1, offset: 0, limit: 50, truncated: false, clips: [{ name: 'A001', fps: 25 }] } },
    { result: { ok: false, error: 'bin not found: /Nope', resolved_path: '/', available_bins: ['Footage'] } },
    { result: { ok: true, timeline: 'TL', track_type: 'video', track_index: 1, track_count: 2, total: 0, offset: 0, limit: 100, truncated: false, items: {} } },
    { result: { ok: true, job_id: 'j1', status: { JobStatus: 'Rendering', CompletionPercentage: 40 }, rendering_in_progress: true } },
    { result: { ok: false, error: 'no project is open in Resolve: open one in Resolve or call open_project' } },
  );
  const r = await rig(stub);
  try {
    const info = structured(await r.client.callTool({ name: 'get_project_info', arguments: {} }));
    assert.equal(info['name'], 'Demo');
    assert.equal(info['ok'], undefined, 'the Lua ok flag is stripped');
    assert.match(stub.lastCode(), /GetSettings\(\)/);
    assert.match(stub.lastCode(), /GetCurrentDatabase\(\)/);

    const projects = structured(await r.client.callTool({ name: 'list_projects', arguments: {} }));
    assert.deepEqual(projects['projects'], [], 'an empty Lua table becomes []');
    assert.match(stub.lastCode(), /GetProjectAttributesInCurrentFolder\(\)/);

    const timelines = structured(await r.client.callTool({ name: 'list_timelines', arguments: {} }));
    assert.deepEqual(timelines['timelines'], []);
    assert.match(stub.lastCode(), /GetTimelineByIndex\(i\)/);
    assert.match(stub.lastCode(), /GetTrackCount\("subtitle"\)/);

    const clips = structured(await r.client.callTool({ name: 'list_media_pool_clips', arguments: { bin_path: '/Footage/Day "1"' } }));
    assert.equal(clips['total'], 1);
    assert.match(stub.lastCode(), /local segments = \{ "Footage", "Day \\"1\\"" \}/);
    assert.match(stub.lastCode(), /local offset, limit = 0, 50/);
    assert.match(stub.lastCode(), /GetClipProperty\(\)/);

    const missing = await r.client.callTool({ name: 'list_media_pool_clips', arguments: { bin_path: 'Nope' } });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /bin not found/);
    assert.deepEqual(structured(missing)['available_bins'], ['Footage']);

    const items = structured(await r.client.callTool({ name: 'get_timeline_items', arguments: { track_type: 'video', track_index: 1, offset: 0, limit: 100 } }));
    assert.deepEqual(items['items'], []);
    assert.match(stub.lastCode(), /GetItemListInTrack\(track_type, index\)/);
    assert.match(stub.lastCode(), /local track_type, index = "video", 1/);

    const status = structured(await r.client.callTool({ name: 'get_render_status', arguments: { job_id: 'j1' } }));
    assert.equal((status['status'] as { JobStatus: string }).JobStatus, 'Rendering');
    assert.match(stub.lastCode(), /GetRenderJobStatus\(job_id\)/);

    const noProject = await r.client.callTool({ name: 'list_timelines', arguments: {} });
    assert.equal(noProject.isError, true);
    assert.match(text(noProject), /no project is open/);

    const badPath = await r.client.callTool({ name: 'list_media_pool_clips', arguments: { bin_path: '/a//b' } });
    assert.equal(badPath.isError, true);
    assert.match(text(badPath), /empty segment/);
    assert.equal(stub.calls.length, 8, 'the bad path never reached the bridge');
  } finally {
    await r.close();
  }
});

test('write tools: markers, timeline switch, project switch and stop', async () => {
  const stub = new StubBridge().reply(
    { result: { ok: true, timeline: 'TL', timeline_unique_id: 't1', frame: 10, marker: { color: 'Blue', name: 'n', note: '', duration: 1, customData: '' } } },
    { result: { ok: false, error: 'AddMarker returned false: the frame is occupied by another marker or lies outside the timeline (frames are relative to the timeline start)', frame: 10 } },
    { result: { ok: true, timeline: 'TL', color: 'All', deleted: 2, remaining: 0 } },
    { result: { ok: false, error: 'unknown timeline: Nope', known_timelines: ['TL'] } },
    { result: { ok: true, name: 'TL', unique_id: 't1', index: 1 } },
    { result: { ok: true, name: 'Other', unique_id: 'p2', previous: 'Demo', saved_previous: true, already_open: false } },
    { op: 'stop', result: { ok: true, session: 'sess' } },
  );
  const r = await rig(stub);
  try {
    const added = structured(await r.client.callTool({ name: 'add_marker', arguments: { frame: 10, color: 'Blue', name: 'n "q"', note: 'line\nbreak' } }));
    assert.equal(added['frame'], 10);
    assert.equal((added['marker'] as { color: string }).color, 'Blue');
    assert.match(stub.lastCode(), /AddMarker\(frame, "Blue", "n \\"q\\"", "line\\nbreak", 1\)/);

    const occupied = await r.client.callTool({ name: 'add_marker', arguments: { frame: 10, color: 'Blue', name: 'n' } });
    assert.equal(occupied.isError, true);
    assert.match(text(occupied), /AddMarker returned false/);

    const refused = await r.client.callTool({ name: 'delete_markers', arguments: {} });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /confirm=true/);
    assert.equal(stub.calls.length, 2, 'refusal never reaches the bridge');
    const deleted = structured(await r.client.callTool({ name: 'delete_markers', arguments: { confirm: true } }));
    assert.equal(deleted['deleted'], 2);
    assert.match(stub.lastCode(), /DeleteMarkersByColor\(color\)/);
    assert.match(stub.lastCode(), /local color = "All"/);

    const unknown = await r.client.callTool({ name: 'set_current_timeline', arguments: { name: 'Nope' } });
    assert.equal(unknown.isError, true);
    assert.deepEqual(structured(unknown)['known_timelines'], ['TL']);
    const switched = structured(await r.client.callTool({ name: 'set_current_timeline', arguments: { name: 'TL' } }));
    assert.equal(switched['unique_id'], 't1');
    assert.match(stub.lastCode(), /SetCurrentTimeline\(tl\)/);

    const opened = structured(await r.client.callTool({ name: 'open_project', arguments: { name: 'Other' } }));
    assert.equal(opened['saved_previous'], true);
    assert.match(stub.lastCode(), /if current and true then/);
    assert.match(stub.lastCode(), /SaveProject\(\)/);
    assert.match(stub.lastCode(), /LoadProject\(name\)/);

    const stopped = structured(await r.client.callTool({ name: 'stop_bridge', arguments: {} }));
    assert.equal(stopped['stopped'], true);
    assert.equal(stopped['session'], 'sess');
    assert.equal(stub.calls[stub.calls.length - 1]?.op, 'stop');
  } finally {
    await r.close();
  }
});

test('render_current_timeline validates the output directory and file name before any Lua', async () => {
  const stub = new StubBridge().reply({ result: { ok: true, timeline: 'TL', job_id: 'job-1', job: { JobId: 'job-1', OutputFilename: 'out.mov' }, format_codec: { format: 'mov', codec: 'H264' }, rendering_in_progress: true } });
  const r = await rig(stub);
  try {
    const rel = await r.client.callTool({ name: 'render_current_timeline', arguments: { output_dir: 'renders', filename: 'out' } });
    assert.equal(rel.isError, true);
    assert.match(text(rel), /absolute path/);
    const missing = await r.client.callTool({ name: 'render_current_timeline', arguments: { output_dir: path.join(r.dirs.root, 'nope'), filename: 'out' } });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /does not exist/);
    const file = path.join(r.dirs.root, 'afile');
    await fsp.writeFile(file, 'x');
    const notDir = await r.client.callTool({ name: 'render_current_timeline', arguments: { output_dir: file, filename: 'out' } });
    assert.match(text(notDir), /not a directory/);
    const badName = await r.client.callTool({ name: 'render_current_timeline', arguments: { output_dir: r.dirs.root, filename: 'a/b' } });
    assert.match(text(badName), /bare file name/);
    assert.equal(stub.calls.length, 0);

    const okRes = structured(await r.client.callTool({ name: 'render_current_timeline', arguments: { output_dir: r.dirs.root, filename: 'out "1"', preset: 'H.264 Master' } }));
    assert.equal(okRes['job_id'], 'job-1');
    assert.match(stub.lastCode(), /LoadRenderPreset\(preset\)/);
    assert.match(stub.lastCode(), /local preset = "H.264 Master"/);
    assert.match(stub.lastCode(), new RegExp(`TargetDir = "${r.dirs.root.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}", CustomName = "out \\\\"1\\\\""`));
    assert.match(stub.lastCode(), /StartRendering\(\{ job_id \}, false\)/);
    assert.ok((stub.calls[0]?.opts.timeoutMs ?? 0) >= 60_000);
  } finally {
    await r.close();
  }
});

test('scripting_api_docs answers from the docs dir and reports a missing one', async () => {
  const r = await rig();
  try {
    const missing = await r.client.callTool({ name: 'scripting_api_docs', arguments: { query: 'AddMarker' } });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /Blackmagic scripting docs not found/);
  } finally {
    await r.close();
  }
  const r2 = await rig();
  try {
    await fsp.writeFile(path.join(r2.dirs.docsDir, 'DaVinciResolveScript.pyi'), 'class Timeline:\n\tdef AddMarker(self, frameId: int) -> bool:\n\t\t"""Creates a new marker."""\n\t\t...\n');
    const hit = structured(await r2.client.callTool({ name: 'scripting_api_docs', arguments: { query: 'AddMarker', limit: 3 } }));
    assert.equal(hit['total_matches'], 1);
    assert.equal((hit['results'] as Array<{ line: number }>)[0]?.line, 2);
  } finally {
    await r2.close();
  }
});

test('end to end through the real BridgeClient and the fake bridge', async () => {
  const dirs = await makeTempDirs();
  const fake = await startFakeBridge({
    stateDir: dirs.stateDir,
    prefsDir: dirs.prefsDir,
    responder: (req) => {
      if (req.op !== 'run') return { ok: true, result: { ok: true, product: 'DaVinci Resolve', version: '21.1.0.17', pid: process.pid, session: 'fake-session-1234', state_dir: dirs.stateDir, uptime_s: 3, bridge: BRIDGE_TAG, session_saved: true, start_save: { ok: true, attempts: 1, ms: 1 } } };
      if (req.code?.includes('IsStudio')) return { ok: true, result: { ok: true, product: 'DaVinci Resolve', version: '21.1.0.17', is_studio: false, current_page: 'edit', project: 'Demo' }, prints: [], ms: 1 };
      return { ok: true, result: { ok: true, name: 'Demo', unique_id: 'u1', timeline_count: 1 }, prints: [], ms: 1 };
    },
  });
  const bridge = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pollMs: 5 });
  const r = await rig(bridge, {});
  try {
    const status = structured(await r.client.callTool({ name: 'resolve_status', arguments: {} }));
    assert.equal(status['alive'], true, JSON.stringify(status));
    assert.equal(status['current_page'], 'edit');
    assert.equal(status['state_dir_match'], true);
    const info = structured(await r.client.callTool({ name: 'get_project_info', arguments: {} }));
    assert.equal(info['name'], 'Demo');
    assert.equal(fake.requests.filter((q) => q.op === 'run').length, 2);
  } finally {
    fake.stop();
    bridge.releaseLockSync();
    await r.close();
  }
});

test('onToolFailure: one call per BridgeError with the tool name; silent on success, Lua failures and resolve_status; survives a throwing hook', async () => {
  const seen: Array<[string, string]> = [];
  let throwNext = false;
  const stub = new StubBridge().reply(
    new BridgeError('timeout', 'the bridge did not answer request abc within 3.0 s', 'wait, then retry', { id: 'abc' }),
    { result: 1, prints: [], ms: 1 },
    new BridgeError('lock_held', 'another server holds the request slot', 'stop it', { holder_pid: 1 }),
    { ok: false, error: 'request:1: boom', prints: [], ms: 1 },
  );
  const r = await rig(stub, {}, {
    onToolFailure: (err, tool) => {
      seen.push([err.kind, tool]);
      if (throwNext) throw new Error('hook exploded');
    },
  });
  try {
    const timeout = await r.client.callTool({ name: 'run_lua', arguments: { code: 'slow' } });
    assert.equal(timeout.isError, true);
    assert.match(text(timeout), /did not answer request abc.*wait, then retry/);
    assert.deepEqual(seen, [['timeout', 'run_lua']]);

    const okRes = await r.client.callTool({ name: 'run_lua', arguments: { code: 'return 1' } });
    assert.notEqual(okRes.isError, true);
    assert.equal(seen.length, 1, 'success never reports');

    throwNext = true;
    const held = await r.client.callTool({ name: 'list_timelines', arguments: {} });
    assert.equal(held.isError, true, 'a throwing hook does not change the result');
    assert.match(text(held), /another server holds the request slot: stop it/);
    assert.equal(structured(held)['kind'], 'lock_held');
    assert.deepEqual(seen[1], ['lock_held', 'list_timelines']);
    throwNext = false;

    const lua = await r.client.callTool({ name: 'run_lua', arguments: { code: 'error("boom")' } });
    assert.equal(lua.isError, true);
    const status = await r.client.callTool({ name: 'resolve_status', arguments: {} });
    assert.notEqual(status.isError, true);
    assert.equal(seen.length, 2, 'Lua-side failures and resolve_status never reach the hook');
  } finally {
    await r.close();
  }
});
