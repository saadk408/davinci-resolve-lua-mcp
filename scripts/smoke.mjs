#!/usr/bin/env node
// smoke.mjs: the end-to-end smoke test of docs/plan.md Step 5. It spawns the BUILT server
// (server/index.js) over stdio exactly as Claude Desktop does, connects with the MCP client and
// drives the tools against the live bridge running inside DaVinci Resolve. It creates and deletes a
// timeline named bridge-smoke, puts a generator or a root-bin clip on it, adds and deletes markers
// on it and renders it into a temp directory. The render changes the project's render TargetDir and
// CustomName (the API has no getter to restore them), so --project must name the open scratch
// project. Nothing else is touched; SaveProject is never called. One line per check, then
// `SMOKE_RESULT: PASS|FAIL`; exit 0 only when nothing failed. Plain Node 20 ESM; the only
// dependency is @modelcontextprotocol/client (a devDependency).
//
//   node scripts/smoke.mjs --project <name>   run every check (the name must equal the open project)
//   node scripts/smoke.mjs --stop             ask the bridge loop to exit (stop_bridge) and quit
//   --no-render      skip the render measurement
//   --timeout <s>    seconds each run_lua waits for the bridge (default 30)
//
// The request-slot lock (<state_dir>/lock) is taken per request, so this script and the installed
// extension can share the bridge; `lock_held` means another server kept the slot busy for longer
// than the wait (a long chunk elsewhere): retry, or stop that server.
// RLB_* variables in the environment are forwarded to the spawned server (the stdio transport does
// not inherit the environment on its own); RLB_LOG_LEVEL defaults to debug here and the server's
// stderr goes to .out/smoke-server.log.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const projectArg = opt('--project', '') || undefined; // an empty SMOKE_PROJECT counts as absent
const stopOnly = args.includes('--stop');
const noRender = args.includes('--no-render');
const toolTimeoutS = Number(opt('--timeout', '30'));
// Purpose-built tools wait the server's default (RLB_DEFAULT_TIMEOUT_S, 30 s); run_lua waits --timeout.
const serverDefaultS = Number(process.env.RLB_DEFAULT_TIMEOUT_S ?? '30') || 30;
const defaultWaitS = Math.max(toolTimeoutS, serverDefaultS);

const TOOL_NAMES = [
  'resolve_status', 'run_lua', 'get_project_info', 'list_projects', 'list_timelines',
  'list_media_pool_clips', 'get_timeline_items', 'add_marker', 'delete_markers',
  'set_current_timeline', 'open_project', 'render_current_timeline', 'get_render_status',
  'stop_bridge', 'scripting_api_docs',
];
const SMOKE_TIMELINE = 'bridge-smoke';
const WATCHDOG_MS = 10 * 60 * 1000;
const RENDER_DEADLINE_MS = 120_000;

function die(message) {
  console.error(`smoke: ${message}`);
  process.exit(2);
}

if (!Number.isInteger(toolTimeoutS) || toolTimeoutS < 1 || toolTimeoutS > 300) die('--timeout must be an integer 1..300');

// ---- Lua helpers (mirror src/lua.ts: every embedded value goes through luaStr) -----------------

function luaStr(s) {
  let out = '"';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString().padStart(3, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

const LUA_PRELUDE = `local pm = resolve:GetProjectManager()
local project = pm and pm:GetCurrentProject()
if not project then error("no project is open in Resolve") end
local function find_tl(id)
  local count = project:GetTimelineCount() or 0
  for i = 1, count do
    local t = project:GetTimelineByIndex(i)
    if t and t:GetUniqueId() == id then return t end
  end
  return nil
end
`;

// ---- reporting --------------------------------------------------------------------------------

const counts = { PASS: 0, FAIL: 0, SKIP: 0, INFO: 0 };
let currentStep = 'startup';

function line(status, name, detail, ms) {
  counts[status] += 1;
  const t = ms === undefined ? '' : ` (${ms} ms)`;
  console.log(`${status} ${name}${t}${detail ? `: ${detail}` : ''}`);
}

class Skip {
  constructor(reason) { this.reason = reason; }
}
class Info {
  constructor(text) { this.text = text; }
}

/** Runs one check: a returned string is the PASS detail, a thrown Error is the FAIL reason. */
async function check(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    if (r instanceof Skip) { line('SKIP', name, r.reason); return false; }
    if (r instanceof Info) { line('INFO', name, r.text, ms); return true; }
    line('PASS', name, typeof r === 'string' ? r : '', ms);
    return true;
  } catch (err) {
    line('FAIL', name, err instanceof Error ? err.message : String(err), Date.now() - t0);
    return false;
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

function asList(x) {
  return Array.isArray(x) ? x : [];
}

function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function holderCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ---- the MCP client ---------------------------------------------------------------------------

let client;
let transport;

async function connect() {
  const serverJs = join(root, 'server', 'index.js');
  if (!existsSync(serverJs)) die(`${serverJs} is missing: run make build`);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('RLB_') && v !== undefined) env[k] = v;
  if (!env.RLB_LOG_LEVEL) env.RLB_LOG_LEVEL = 'debug';
  const outDir = join(root, '.out');
  mkdirSync(outDir, { recursive: true });
  transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], env, stderr: 'pipe' });
  transport.stderr?.pipe(createWriteStream(join(outDir, 'smoke-server.log')));
  client = new Client({ name: 'rlb-smoke', version: '0.1.0' });
  await client.connect(transport);
  console.log(`server: ${process.execPath} ${serverJs} (pid ${transport.pid ?? '?'}), env ${Object.keys(env).join(' ')}, log .out/smoke-server.log`);
}

/** callTool with an explicit timeout; results are read from structuredContent only. */
async function call(name, toolArgs = {}, waitS = defaultWaitS) {
  const res = await client.callTool({ name, arguments: toolArgs }, { timeout: (waitS + 15) * 1000 });
  const data = res.structuredContent && typeof res.structuredContent === 'object' ? res.structuredContent : {};
  const first = Array.isArray(res.content) ? res.content[0] : undefined;
  const text = first && first.type === 'text' ? first.text : '';
  return { isError: res.isError === true, data, text };
}

/** run_lua that must succeed; returns the chunk's result. */
async function lua(code) {
  const r = await call('run_lua', { code, timeout_s: toolTimeoutS }, toolTimeoutS);
  if (r.isError) throw new Error(`run_lua failed: ${r.data.error ?? r.text}`);
  if (r.data.truncated === true) throw new Error(`run_lua result truncated (${r.data.result_bytes} bytes)`);
  return r.data.result;
}

// ---- status -----------------------------------------------------------------------------------

function printStatus(s) {
  const ses = s.session;
  if (ses && typeof ses === 'object') {
    const started = typeof ses.started === 'number' ? new Date(ses.started * 1000).toISOString() : '?';
    console.log(`  session: ${ses.session} state=${ses.state} pid=${ses.pid} (alive ${s.pid_alive}) started=${started} bridge="${ses.bridge}" state_dir=${ses.state_dir} (${ses.state_dir_source}) match=${s.state_dir_match}`);
  } else {
    console.log('  session: none (RLBSession absent from Fusion.prefs)');
  }
  console.log(`  prefs: ${s.prefs_file ?? 'not found'} (mtime ${s.prefs_mtime ?? '?'})`);
  console.log(`  bridge_script: ${s.bridge_script?.outcome}: ${s.bridge_script?.message}`);
  console.log(`  lock: owned=${s.lock?.owned} path=${s.lock?.path}${s.lock?.holder_pid ? ` holder_pid=${s.lock.holder_pid}` : ''}`);
  const problems = asList(s.config_problems);
  console.log(`  config_problems: ${problems.length ? problems.join('; ') : 'none'}`);
  console.log(`  server: ${s.server?.name} ${s.server?.version} pid ${s.server?.pid} node ${s.server?.node}`);
}

function describeNotAlive(s) {
  let msg = `reason ${s.reason}${s.detail ? ` (${s.detail})` : ''}`;
  if (s.reason === 'lock_held') {
    const pid = s.lock?.holder_pid;
    const cmd = pid ? holderCommand(pid) : '';
    msg += `; ${s.lock?.path} was kept by pid ${pid}${cmd ? ` [${cmd}]` : ''} for longer than the wait (a long chunk elsewhere, or a stale lock whose pid is alive). Retry; if it persists, stop that server (the extension in Claude Desktop, a dev-register entry) or remove the lock file by hand`;
  } else {
    msg += `; ${s.start_instruction ?? 'start the bridge in Resolve'}`;
  }
  return msg;
}

// ---- the run ----------------------------------------------------------------------------------

const st = {
  stateDir: process.env.RLB_STATE_DIR || join(homedir(), '.resolve-lua-bridge'),
  projectName: undefined,
  smokeId: undefined,
  prevTimelineId: undefined,
  prevTimelineName: undefined,
  prevPage: undefined,
  jobId: undefined,
  renderDir: undefined,
};

function manualCleanup() {
  const parts = [`delete the timeline "${SMOKE_TIMELINE}"${st.smokeId ? ` (unique id ${st.smokeId})` : ''} from the Media Pool`];
  if (st.jobId) parts.push(`remove render job ${st.jobId} from the Deliver page render queue`);
  if (st.renderDir) parts.push(`delete ${st.renderDir}`);
  if (st.prevTimelineName) parts.push(`make ${JSON.stringify(st.prevTimelineName)} the current timeline again`);
  return `Manual cleanup in Resolve: ${parts.join('; ')}`;
}

async function smoke() {
  await check('tools/list has the 15 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(JSON.stringify(names) === JSON.stringify([...TOOL_NAMES].sort()), `got ${names.length}: ${names.join(' ')}`);
    return `${names.length} tools`;
  });

  await check('scripting_api_docs AddMarker (no bridge needed)', async () => {
    const r = await call('scripting_api_docs', { query: 'AddMarker', limit: 3 }, 10);
    expect(!r.isError, r.data.error ?? r.text);
    const hits = asList(r.data.results);
    const hit = hits.find((h) => h && h.name === 'AddMarker' && typeof h.line === 'number');
    expect(hit, `no AddMarker hit among ${hits.length} results`);
    return `${hit.class ?? '?'}.AddMarker at ${hit.file}:${hit.line} (${r.data.total_matches} matches)`;
  });

  let status;
  const alive = await check('resolve_status alive', async () => {
    const r = await call('resolve_status', {}, 15);
    status = r.data;
    if (typeof status.state_dir === 'string') st.stateDir = status.state_dir;
    printStatus(status);
    expect(status.alive === true, describeNotAlive(status));
    expect(status.status_error === undefined, `status snippet failed: ${status.status_error}`);
    return `${status.product} ${status.version} (${status.is_studio ? 'Studio' : 'free'}), page ${status.current_page}, project ${JSON.stringify(status.project ?? null)}, ping ${status.ping_ms} ms`;
  });
  if (!alive) return 1;

  const repoVersion = readFileSync(join(root, 'bridge', 'resolve_lua_bridge.lua'), 'utf8').split('\n')[0].replace(/^--\s*/, '').trim();
  const ready = await check('installed bridge script is current and the running loop has the repo version', async () => {
    const outcome = status.bridge_script?.outcome;
    expect(outcome === 'up_to_date', `self-install outcome ${outcome} (${status.bridge_script?.message}); the loop in Resolve runs an older script: relaunch Workspace > Scripts > resolve_lua_bridge, then rerun`);
    const running = status.session?.bridge;
    expect(running === repoVersion, `running bridge is "${running}", the repo is "${repoVersion}": relaunch Workspace > Scripts > resolve_lua_bridge`);
    expect(status.state_dir_match !== false, `the bridge uses state dir ${status.session?.state_dir}, the server ${status.state_dir}`);
    return `${repoVersion}, state dir ${st.stateDir}`;
  });
  const confirmed = await check('open project matches --project (scratch-project confirmation)', async () => {
    const open = status.project;
    expect(typeof open === 'string' && open.length > 0, 'no project is open in Resolve; open the scratch project first');
    expect(projectArg !== undefined, `pass --project ${JSON.stringify(open)} (make smoke SMOKE_PROJECT=...) to confirm that the open project may be modified: this run creates and deletes a timeline named ${SMOKE_TIMELINE} and changes the render TargetDir and CustomName`);
    expect(projectArg === open, `--project is ${JSON.stringify(projectArg)} but the open project is ${JSON.stringify(open)}; refusing`);
    st.projectName = open;
    return JSON.stringify(open);
  });
  if (!ready || !confirmed) return 1;

  await check('latency: five run_lua("return 1 + 1") round trips', async () => {
    const wall = [];
    const bridgeMs = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = Date.now();
      const r = await call('run_lua', { code: 'return 1 + 1', timeout_s: toolTimeoutS }, toolTimeoutS);
      wall.push(Date.now() - t0);
      expect(!r.isError && r.data.result === 2, `unexpected result ${JSON.stringify(r.data.result ?? r.data.error)}`);
      if (typeof r.data.ms === 'number') bridgeMs.push(r.data.ms);
    }
    return `median round trip ${median(wall)} ms (min ${Math.min(...wall)}, max ${Math.max(...wall)}); bridge-side median ${median(bridgeMs)} ms`;
  });

  await check('run_lua captures prints', async () => {
    const r = await call('run_lua', { code: 'print("hi") return true', timeout_s: toolTimeoutS }, toolTimeoutS);
    expect(!r.isError, r.data.error ?? r.text);
    expect(r.data.result === true && Array.isArray(r.data.prints) && r.data.prints[0] === 'hi', JSON.stringify(r.data));
    return `prints ${JSON.stringify(r.data.prints)}`;
  });

  await check('run_lua reports a Lua error as isError', async () => {
    const r = await call('run_lua', { code: 'error("boom")', timeout_s: toolTimeoutS }, toolTimeoutS);
    expect(r.isError === true, `no isError: ${JSON.stringify(r.data)}`);
    expect(String(r.data.error ?? '').includes('boom'), `error text ${JSON.stringify(r.data.error)}`);
    return `error ${JSON.stringify(r.data.error)}`;
  });

  let info;
  await check('get_project_info', async () => {
    const r = await call('get_project_info');
    expect(!r.isError, r.data.error ?? r.text);
    info = r.data;
    expect(info.name === st.projectName, `name ${JSON.stringify(info.name)} differs from resolve_status ${JSON.stringify(st.projectName)}`);
    st.prevPage = typeof info.current_page === 'string' ? info.current_page : undefined;
    if (info.current_timeline && typeof info.current_timeline === 'object') {
      st.prevTimelineId = info.current_timeline.unique_id;
      st.prevTimelineName = info.current_timeline.name;
    }
    return `${JSON.stringify(info.name)}: ${info.frame_rate} fps ${info.width}x${info.height}, ${info.database?.DbType} ${JSON.stringify(info.database?.DbName)}, ${info.timeline_count} timeline(s), root bin ${info.root_bin?.clips} clip(s) ${info.root_bin?.sub_bins} bin(s), current timeline ${st.prevTimelineName ? JSON.stringify(st.prevTimelineName) : 'none'}, page ${info.current_page}`;
  });

  await check('list_projects marks the open project', async () => {
    const r = await call('list_projects');
    expect(!r.isError, r.data.error ?? r.text);
    const projects = asList(r.data.projects);
    const cur = projects.find((p) => p && p.is_current === true);
    expect(cur && cur.name === st.projectName, `current project not marked (current ${JSON.stringify(r.data.current)}, ${projects.length} listed)`);
    return `${projects.length} project(s) in folder ${JSON.stringify(r.data.folder)}, current ${JSON.stringify(cur.name)}`;
  });

  const noClash = await check(`list_timelines and no pre-existing ${SMOKE_TIMELINE}`, async () => {
    const r = await call('list_timelines');
    expect(!r.isError, r.data.error ?? r.text);
    const tls = asList(r.data.timelines);
    const clash = tls.find((t) => t && t.name === SMOKE_TIMELINE);
    expect(!clash, `a timeline named ${SMOKE_TIMELINE} already exists (unique id ${clash?.unique_id}); delete it by hand in Resolve, this script never touches a timeline it did not create`);
    expect(tls.length === info.timeline_count, `${tls.length} listed, get_project_info said ${info.timeline_count}`);
    return `${tls.length} timeline(s), current ${JSON.stringify(r.data.current_unique_id ?? null)}`;
  });
  if (!noClash) return 1;

  let code = 0;
  try {
    const created = await check(`create timeline ${SMOKE_TIMELINE} (CreateEmptyTimeline)`, async () => {
      const r = await lua(`${LUA_PRELUDE}local mp = project:GetMediaPool()
if not mp then error("GetMediaPool returned nil") end
local tl = mp:CreateEmptyTimeline(${luaStr(SMOKE_TIMELINE)})
if not tl then error("CreateEmptyTimeline returned nil") end
local cur = project:GetCurrentTimeline()
return { name = tl:GetName(), unique_id = tl:GetUniqueId(), start_frame = tl:GetStartFrame(), end_frame = tl:GetEndFrame(),
  is_current = (cur ~= nil and cur:GetUniqueId() == tl:GetUniqueId()), page = resolve:GetCurrentPage() }`);
      expect(r && typeof r.unique_id === 'string' && r.unique_id.length > 0, `unexpected result ${JSON.stringify(r)}`);
      st.smokeId = r.unique_id;
      expect(r.name === SMOKE_TIMELINE, `name ${JSON.stringify(r.name)}`);
      expect(r.is_current === true, 'the new timeline is not the current one (Step 1 measured that it becomes current)');
      return `unique id ${r.unique_id}, frames ${r.start_frame}..${r.end_frame}, current, page ${r.page}`;
    });
    if (!created) return 1;

    let content = 'none';
    await check(`content on ${SMOKE_TIMELINE} (generator, else a root-bin clip)`, async () => {
      const r = await lua(`${LUA_PRELUDE}local id = ${luaStr(st.smokeId)}
local tl = find_tl(id)
if not tl then error("bridge-smoke not found by unique id") end
local cur = project:GetCurrentTimeline()
if not cur or cur:GetUniqueId() ~= id then
  if not project:SetCurrentTimeline(tl) then error("SetCurrentTimeline returned false") end
end
local function items() return #(tl:GetItemListInTrack("video", 1) or {}) end
local r = { before = items(), path = "none", video_tracks = tl:GetTrackCount("video") }
local okg, gen = pcall(function() return tl:InsertGeneratorIntoTimeline("Solid Color") end)
r.generator_call_ok = okg
if okg then r.generator_returned_item = (gen ~= nil) else r.generator_error = tostring(gen) end
r.after_generator = items()
if r.after_generator > r.before then
  r.path = "generator"
else
  local mp = project:GetMediaPool()
  local clips = mp:GetRootFolder():GetClipList() or {}
  r.root_clips = #clips
  local pick, fallback = nil, nil
  for i = 1, #clips do
    local p = clips[i]:GetClipProperty() or {}
    local t = p["Type"] or ""
    if t ~= "Timeline" then
      if not pick and string.find(t, "Video", 1, true) then pick = clips[i]; r.clip = p["Clip Name"] or clips[i]:GetName(); r.clip_type = t end
      if not fallback then fallback = clips[i]; r.fallback_clip = p["Clip Name"] or clips[i]:GetName(); r.fallback_type = t end
    end
  end
  if not pick and fallback then pick = fallback; r.clip = r.fallback_clip; r.clip_type = r.fallback_type end
  if pick then
    local cur2 = project:GetCurrentTimeline()
    if not cur2 or cur2:GetUniqueId() ~= id then error("the current timeline is not bridge-smoke; refusing to append") end
    local added = mp:AppendToTimeline({ { mediaPoolItem = pick } }) or {}
    r.appended = #added
    r.after_clip = items()
    if r.after_clip > r.before then r.path = "clip" end
  end
end
r.start_frame = tl:GetStartFrame()
r.end_frame = tl:GetEndFrame()
return r`);
      content = r.path;
      const gen = r.generator_call_ok ? (r.after_generator > r.before ? 'inserted an item' : `returned ${r.generator_returned_item ? 'an item' : 'nil'} but the track stayed empty`) : `threw ${r.generator_error}`;
      if (r.path === 'none') {
        return new Skip(`no content could be added (InsertGeneratorIntoTimeline("Solid Color") ${gen}; root bin has ${r.root_clips} clip(s)${r.clip ? `, AppendToTimeline of ${JSON.stringify(r.clip)} added ${r.appended} item(s)` : ''}); the marker and render checks are skipped`);
      }
      const via = r.path === 'generator' ? `Solid Color generator` : `AppendToTimeline of ${JSON.stringify(r.clip)} (${r.clip_type}, ${r.appended} item(s))`;
      return `${via}; video items ${r.before} -> ${r.path === 'generator' ? r.after_generator : r.after_clip}; frames ${r.start_frame}..${r.end_frame}; generator call ${gen}`;
    });
    const hasContent = content !== 'none';

    let markersAdded = 0;
    const addMarker = (frame, name) => call('add_marker', { frame, color: 'Blue', name, note: SMOKE_TIMELINE, duration: 1 });
    if (hasContent) {
      await check('add_marker frame 1 (relative to the timeline start, the Step 1 case)', async () => {
        const r = await addMarker(1, 'smoke-1');
        expect(!r.isError, r.data.error ?? r.text);
        markersAdded += 1;
        expect(r.data.marker && r.data.marker.name === 'smoke-1', `marker not read back: ${JSON.stringify(r.data.marker)}`);
        return `on ${JSON.stringify(r.data.timeline)}: ${JSON.stringify(r.data.marker)}`;
      });
      await check('add_marker frame 0 (measurement)', async () => {
        const r = await addMarker(0, 'smoke-0');
        if (r.isError) return new Info(`frame 0 refused: ${r.data.error}`);
        markersAdded += 1;
        return new Info(`frame 0 accepted: ${JSON.stringify(r.data.marker)}`);
      });
      await check('add_marker frame 1 again (occupied frame, measurement)', async () => {
        const r = await addMarker(1, 'smoke-dup');
        if (r.isError) return new Info(`refused as the tool description says: ${r.data.error}`);
        markersAdded += 1;
        return new Info(`Resolve accepted a second marker at frame 1: ${JSON.stringify(r.data.marker)} (the add_marker description assumes a refusal)`);
      });
      await check('GetMarkers read-back (checked in Lua by key)', async () => {
        const r = await lua(`${LUA_PRELUDE}local tl = find_tl(${luaStr(st.smokeId)})
if not tl then error("bridge-smoke not found by unique id") end
local m = tl:GetMarkers() or {}
local count = 0
for _, v in pairs(m) do if type(v) == "table" then count = count + 1 end end
return { has0 = m[0] ~= nil, has1 = m[1] ~= nil, count = count, name1 = m[1] and m[1].name or nil, name0 = m[0] and m[0].name or nil }`);
        expect(r.has1 === true && r.name1 === 'smoke-1', `frame 1 marker missing: ${JSON.stringify(r)}`);
        expect(r.count === markersAdded, `GetMarkers has ${r.count} marker(s), ${markersAdded} were added`);
        return `count ${r.count}, frame 1 ${JSON.stringify(r.name1)}, frame 0 ${r.has0 ? JSON.stringify(r.name0) : 'absent'}`;
      });
    } else {
      line('SKIP', 'add_marker / GetMarkers', `no content on ${SMOKE_TIMELINE}`);
    }

    await check('get_timeline_items pagination (video track 1, limit 1)', async () => {
      const r = await call('get_timeline_items', { track_type: 'video', track_index: 1, offset: 0, limit: 1 });
      expect(!r.isError, r.data.error ?? r.text);
      const items = asList(r.data.items);
      expect(typeof r.data.total === 'number' && r.data.offset === 0 && r.data.limit === 1, `shape ${JSON.stringify({ total: r.data.total, offset: r.data.offset, limit: r.data.limit })}`);
      expect(items.length === Math.min(1, r.data.total), `${items.length} item(s) returned for total ${r.data.total}`);
      expect(r.data.truncated === items.length < r.data.total, `truncated ${r.data.truncated} with ${items.length} of ${r.data.total}`);
      const first = items[0];
      return `total ${r.data.total}, returned ${items.length}, truncated ${r.data.truncated}, track ${JSON.stringify(r.data.track_name)} of ${r.data.track_count}${first ? `; first ${JSON.stringify(first.name)} ${first.type} ${first.start}..${first.end}` : ''}`;
    });

    await check('list_media_pool_clips pagination (root bin, limit 1)', async () => {
      const r = await call('list_media_pool_clips', { bin_path: '/', offset: 0, limit: 1 });
      expect(!r.isError, r.data.error ?? r.text);
      const clips = asList(r.data.clips);
      expect(typeof r.data.total === 'number' && r.data.offset === 0 && r.data.limit === 1, `shape ${JSON.stringify({ total: r.data.total, offset: r.data.offset, limit: r.data.limit })}`);
      expect(clips.length === Math.min(1, r.data.total), `${clips.length} clip(s) returned for total ${r.data.total}`);
      expect(r.data.truncated === clips.length < r.data.total, `truncated ${r.data.truncated} with ${clips.length} of ${r.data.total}`);
      const first = clips[0];
      return `total ${r.data.total}, returned ${clips.length}, truncated ${r.data.truncated}${first ? `; first ${JSON.stringify(first.name)} ${first.type} ${first.resolution} ${first.fps} fps` : ''}`;
    });

    await check('run_lua truncated result (a 200 KB string, above the 192 KB ceiling)', async () => {
      const r = await call('run_lua', { code: 'return string.rep("x", 200 * 1024)', timeout_s: toolTimeoutS }, toolTimeoutS);
      expect(!r.isError, r.data.error ?? r.text);
      expect(r.data.truncated === true && r.data.result === null, `truncated ${r.data.truncated}, result ${typeof r.data.result}`);
      expect(typeof r.data.result_bytes === 'number' && r.data.result_bytes > 192 * 1024, `result_bytes ${r.data.result_bytes}`);
      expect(typeof r.data.result_preview === 'string' && r.data.result_preview.length > 0, 'no result_preview');
      return `result_bytes ${r.data.result_bytes}, preview ${r.data.result_preview.length} chars, bridge ${r.data.ms} ms`;
    });

    if (hasContent) {
      await check('delete_markers refuses without confirm', async () => {
        const r = await call('delete_markers', { color: 'Blue', confirm: false });
        expect(r.isError === true, `not refused: ${JSON.stringify(r.data)}`);
        expect(/confirm/i.test(String(r.data.error)), `error text ${JSON.stringify(r.data.error)}`);
        return String(r.data.error);
      });
      await check('delete_markers Blue with confirm=true', async () => {
        const r = await call('delete_markers', { color: 'Blue', confirm: true });
        expect(!r.isError, r.data.error ?? r.text);
        expect(r.data.deleted === markersAdded && r.data.remaining === 0, `deleted ${r.data.deleted} (added ${markersAdded}), remaining ${r.data.remaining}`);
        return `deleted ${r.data.deleted}, remaining ${r.data.remaining}`;
      });
    }

    if (!hasContent) {
      line('SKIP', 'render_current_timeline', `no content on ${SMOKE_TIMELINE}; deliver page required: not measured`);
    } else if (noRender) {
      line('SKIP', 'render_current_timeline', '--no-render; deliver page required: not measured');
    } else {
      await check('render_current_timeline + get_render_status (Deliver-page measurement)', async () => {
        st.renderDir = mkdtempSync(join(tmpdir(), 'bridge-smoke-'));
        const start = () => call('render_current_timeline', { output_dir: st.renderDir, filename: SMOKE_TIMELINE }, 75);
        const pageBefore = await lua('return resolve:GetCurrentPage()');
        let r = await start();
        let deliverRequired = 'no';
        let firstError;
        if (r.isError) {
          firstError = r.data.error ?? r.text;
          const sw = await lua('return resolve:OpenPage("deliver")');
          expect(sw === true, `OpenPage("deliver") returned ${JSON.stringify(sw)} after the first attempt failed on page ${pageBefore}: ${firstError}`);
          r = await start();
          expect(!r.isError, `failed on page ${pageBefore} (${firstError}) and on the deliver page (${r.data.error ?? r.text})`);
          deliverRequired = 'yes';
        }
        expect(typeof r.data.job_id === 'string' && r.data.job_id.length > 0, `no job id: ${JSON.stringify(r.data)}`);
        st.jobId = r.data.job_id;
        const job = r.data.job && typeof r.data.job === 'object' ? r.data.job : null;
        const t0 = Date.now();
        let last = {};
        let polls = 0;
        for (;;) {
          const s = await call('get_render_status', { job_id: st.jobId }, 45);
          expect(!s.isError, s.data.error ?? s.text);
          polls += 1;
          last = s.data.status && typeof s.data.status === 'object' ? s.data.status : {};
          const js = String(last.JobStatus ?? '');
          if (!(js.startsWith('Ready') || js === 'Rendering')) break;
          if (Date.now() - t0 >= RENDER_DEADLINE_MS) {
            await lua(`${LUA_PRELUDE}project:StopRendering() return true`);
            throw new Error(`still ${js} (${last.CompletionPercentage}%) after ${RENDER_DEADLINE_MS / 1000} s; StopRendering called`);
          }
          await sleep(1000);
        }
        const js = String(last.JobStatus ?? '');
        expect(js === 'Complete', `job ended ${JSON.stringify(js)}${last.Error ? `: ${last.Error}` : ''}`);
        const files = readdirSync(st.renderDir);
        expect(files.length > 0, `no file rendered into ${st.renderDir}`);
        const outFile = job && typeof job.TargetDir === 'string' && typeof job.OutputFilename === 'string' ? join(job.TargetDir, job.OutputFilename) : undefined;
        const pageAfter = await lua('return resolve:GetCurrentPage()');
        return `deliver page required: ${deliverRequired} (started from page ${pageBefore}${firstError ? `; first attempt: ${firstError}` : ''}); job ${st.jobId} Complete after ${polls} poll(s), ${last.TimeTakenToRenderInMs ?? '?'} ms, format ${JSON.stringify(r.data.format_codec ?? null)}; output ${files.join(', ')}${outFile ? ` (job.OutputFilename ${existsSync(outFile) ? 'exists' : 'missing'})` : ''}; page after ${pageAfter}`;
      });
    }

    if (st.prevTimelineName) {
      await check('set_current_timeline back to the previous timeline', async () => {
        const r = await call('set_current_timeline', { name: st.prevTimelineName });
        expect(!r.isError, r.data.error ?? r.text);
        expect(r.data.unique_id === st.prevTimelineId, `unique id ${r.data.unique_id} differs from ${st.prevTimelineId} (a duplicate name?)`);
        return `${JSON.stringify(r.data.name)} (index ${r.data.index})`;
      });
    }
  } finally {
    if (!(await cleanup())) code = 1;
  }

  await check(`list_timelines no longer lists ${SMOKE_TIMELINE}`, async () => {
    const r = await call('list_timelines');
    expect(!r.isError, r.data.error ?? r.text);
    const tls = asList(r.data.timelines);
    expect(!tls.some((t) => t && t.name === SMOKE_TIMELINE), `${SMOKE_TIMELINE} is still listed`);
    expect(tls.length === info.timeline_count, `${tls.length} timeline(s), ${info.timeline_count} before the run`);
    const cur = tls.find((t) => t && t.is_current === true);
    if (st.prevTimelineId) expect(cur && cur.unique_id === st.prevTimelineId, `current timeline is ${JSON.stringify(cur?.name)}, expected ${JSON.stringify(st.prevTimelineName)}`);
    return `${tls.length} timeline(s), current ${cur ? JSON.stringify(cur.name) : 'none'}`;
  });
  console.log(`note: project ${JSON.stringify(st.projectName)} was modified (a timeline created and deleted${st.jobId ? ', render TargetDir/CustomName set' : ''}); Resolve's live save persists this.`);
  return code;
}

/** Deletes bridge-smoke by unique id, restores the previous timeline and page, removes the temp dir. */
async function cleanup() {
  if (!st.smokeId) {
    if (st.renderDir) rmSync(st.renderDir, { recursive: true, force: true });
    return true;
  }
  return check(`cleanup: delete ${SMOKE_TIMELINE}, restore the timeline and page`, async () => {
    let r;
    try {
      r = await lua(`${LUA_PRELUDE}local id = ${luaStr(st.smokeId)}
local r = {}
if project:IsRenderingInProgress() then project:StopRendering(); r.stopped_render = true end
${st.jobId ? `r.job_deleted = project:DeleteRenderJob(${luaStr(st.jobId)})` : ''}
${st.prevTimelineId ? `local prev = find_tl(${luaStr(st.prevTimelineId)})
if prev then r.restored_timeline = project:SetCurrentTimeline(prev) else r.restored_timeline = "previous timeline not found" end` : ''}
local smoke = find_tl(id)
if smoke then r.deleted_timeline = project:GetMediaPool():DeleteTimelines({ smoke }) else r.deleted_timeline = "absent" end
${st.prevPage ? `if resolve:GetCurrentPage() ~= ${luaStr(st.prevPage)} then r.page_restored = resolve:OpenPage(${luaStr(st.prevPage)}) end` : ''}
r.page = resolve:GetCurrentPage()
r.timeline_count = project:GetTimelineCount()
r.smoke_present = find_tl(id) ~= nil
return r`);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}. ${manualCleanup()}`);
    }
    expect(r.deleted_timeline === true || r.deleted_timeline === 'absent', `DeleteTimelines returned ${JSON.stringify(r.deleted_timeline)}. ${manualCleanup()}`);
    expect(r.smoke_present === false, `${SMOKE_TIMELINE} is still present. ${manualCleanup()}`);
    if (st.jobId) expect(r.job_deleted === true, `DeleteRenderJob returned ${JSON.stringify(r.job_deleted)}; remove job ${st.jobId} from the render queue by hand`);
    if (st.prevTimelineId) expect(r.restored_timeline === true, `restoring the previous timeline: ${JSON.stringify(r.restored_timeline)}`);
    if (st.prevPage) expect(r.page === st.prevPage, `page is ${r.page}, expected ${st.prevPage}`);
    if (st.renderDir) rmSync(st.renderDir, { recursive: true, force: true });
    return `timeline deleted${r.stopped_render ? ' (render stopped first)' : ''}, ${r.timeline_count} timeline(s) left, page ${r.page}${st.jobId ? ', render job deleted' : ''}${st.renderDir ? ', temp dir removed' : ''}`;
  });
}

async function stopBridge() {
  const r = await call('stop_bridge', {}, 10);
  if (r.isError) {
    console.log(`stop: ${r.data.error ?? r.text}`);
    return 1;
  }
  console.log(`stop: bridge "${r.data.bridge ?? '?'}" session ${r.data.session ?? '?'} stopped; relaunch it from Workspace > Scripts when needed`);
  return 0;
}

async function finish(code) {
  currentStep = 'closing the server';
  try {
    await client?.close();
  } catch (err) {
    line('FAIL', 'client.close', err instanceof Error ? err.message : String(err));
  }
  await check('lock and next.lua released after close', async () => {
    const lock = join(st.stateDir, 'lock');
    const req = join(st.stateDir, 'next.lua');
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && (existsSync(lock) || existsSync(req))) await sleep(100);
    expect(!existsSync(lock), `${lock} still exists`);
    expect(!existsSync(req), `${req} still exists`);
    return `${st.stateDir} clean`;
  });
  const failed = counts.FAIL > 0 || code !== 0;
  console.log(`SMOKE_RESULT: ${failed ? 'FAIL' : 'PASS'} (${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped, ${counts.INFO} measured)`);
  process.exit(failed ? 1 : 0);
}

setTimeout(() => {
  console.log(`SMOKE_RESULT: FAIL (watchdog: still in "${currentStep}" after ${WATCHDOG_MS / 60000} min; a modal dialog in Resolve wedges the bridge until it is answered). ${manualCleanup()}`);
  process.exit(1);
}, WATCHDOG_MS).unref();

process.on('SIGINT', () => {
  console.log(`\nSMOKE_RESULT: FAIL (interrupted during "${currentStep}"). ${manualCleanup()}`);
  process.exit(130);
});

let exitCode = 1;
try {
  await connect();
  exitCode = stopOnly ? await stopBridge() : await smoke();
} catch (err) {
  line('FAIL', currentStep, err instanceof Error ? err.message : String(err));
}
await finish(exitCode);
