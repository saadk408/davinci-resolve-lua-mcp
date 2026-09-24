import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  allSnippetSamples,
  captureInfoSnippet,
  captureRunSnippet,
  formatRequest,
  ID_RE,
  longBracketLevel,
  luaInt,
  luaLongBracket,
  luaString,
  luaStringList,
  MARKER_COLORS,
  SESSION_RE,
  type MarkerQuery,
} from '../src/lua.js';
import { makeTempDirs, repoRoot } from './helpers/tmp.js';
import { parseRequestFile } from './helpers/fakeBridge.js';

export const FUSCRIPT = '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript';
/** Skip option for tests that need Resolve's Lua runner (absent on a machine without Resolve). */
export const NEEDS_FUSCRIPT = { skip: existsSync(FUSCRIPT) ? false : 'fuscript not installed' };
const execFileAsync = promisify(execFile);

/** Run a Lua file under fuscript and return stdout without the two banner lines. */
export async function runFuscript(file: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await execFileAsync(FUSCRIPT, ['-l', 'lua', file], { env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 });
  return stdout
    .split('\n')
    .filter((l) => !l.startsWith('DaVinci Resolve Script') && !l.startsWith('Copyright'))
    .join('\n');
}

test('luaString escapes what Lua 5.1 needs and passes UTF-8 through', () => {
  assert.equal(luaString('plain'), '"plain"');
  assert.equal(luaString('say "hi"'), '"say \\"hi\\""');
  assert.equal(luaString('back\\slash'), '"back\\\\slash"');
  assert.equal(luaString('a\nb\rc\td'), '"a\\nb\\rc\\td"');
  assert.equal(luaString('\u0000\u0001\u001f\u007f'), '"\\000\\001\\031\\127"');
  assert.equal(luaString(']] ]==] --'), '"]] ]==] --"');
  assert.equal(luaString('é日本😀'), '"é日本😀"');
  assert.equal(luaString('x\uD800y'), '"x�y"');
  assert.equal(luaString(''), '""');
  assert.equal(luaStringList(['a', 'b"c']), '{ "a", "b\\"c" }');
  assert.equal(luaStringList([]), '{  }');
});

test('luaInt refuses non-integers', () => {
  assert.equal(luaInt(42), '42');
  assert.equal(luaInt(-1), '-1');
  assert.throws(() => luaInt(1.5));
  assert.throws(() => luaInt(Number.NaN));
  assert.throws(() => luaInt(Number.POSITIVE_INFINITY));
});

test('long brackets pick a level the code cannot close', () => {
  assert.equal(longBracketLevel('return 1'), 2);
  assert.equal(longBracketLevel('x = "]==]"'), 3);
  assert.equal(longBracketLevel(']==] ]===] ]====]'), 5);
  assert.equal(luaLongBracket('return 1'), '[==[\nreturn 1]==]');
  assert.equal(luaLongBracket('\nleading newline'), '[==[\n\nleading newline]==]');
  assert.equal(luaLongBracket('a ]==] b'), '[===[\na ]==] b]===]');
});

test('formatRequest writes protocol v1 and validates its fields', () => {
  const text = formatRequest({ id: 'abc123', session: 'sess-1', op: 'run', ts: 1758412345, maxKb: 64, code: 'return 1 + 1' });
  assert.equal(
    text,
    ['return {', '  v = 1,', '  id = "abc123",', '  session = "sess-1",', '  op = "run",', '  ts = 1758412345,', '  max_kb = 64,', '  code = [==[', 'return 1 + 1]==],', '}', ''].join('\n'),
  );
  const parsed = parseRequestFile(text);
  assert.deepEqual(parsed, { v: 1, id: 'abc123', session: 'sess-1', op: 'run', ts: 1758412345, max_kb: 64, code: 'return 1 + 1' });
  const ping = formatRequest({ id: 'p1', session: '*', op: 'ping', ts: 1, maxKb: 1 });
  assert.ok(!ping.includes('code ='));
  assert.equal(parseRequestFile(ping).session, '*');
  assert.throws(() => formatRequest({ id: 'bad id', session: '*', op: 'ping', ts: 1, maxKb: 64 }), /request id/);
  assert.throws(() => formatRequest({ id: 'x'.repeat(65), session: '*', op: 'ping', ts: 1, maxKb: 64 }), /request id/);
  assert.throws(() => formatRequest({ id: 'a', session: 'bad session', op: 'ping', ts: 1, maxKb: 64 }), /session/);
  assert.throws(() => formatRequest({ id: 'a', session: '*', op: 'run', ts: 1, maxKb: 64 }), /needs code/);
  assert.throws(() => formatRequest({ id: 'a', session: '*', op: 'ping', ts: 1, maxKb: 64, code: 'x' }), /takes no code/);
  assert.throws(() => formatRequest({ id: 'a', session: '*', op: 'ping', ts: 1.5, maxKb: 64 }), /ts/);
  assert.throws(() => formatRequest({ id: 'a', session: '*', op: 'ping', ts: 1, maxKb: 500 }), /max_kb/);
  assert.throws(() => formatRequest({ id: 'a', session: '*', op: 'dance' as 'ping', ts: 1, maxKb: 64 }), /unknown op/);
  assert.ok(ID_RE.test('0123456789abcdef0123456789abcdef'));
  assert.ok(SESSION_RE.test('*') && SESSION_RE.test('41262d6a-3b88') && !SESSION_RE.test('a b'));
});

test('the marker colour list is the .pyi MarkerColor literal', () => {
  assert.equal(MARKER_COLORS.length, 16);
  assert.equal(new Set(MARKER_COLORS).size, 16);
  assert.equal(MARKER_COLORS[0], 'Blue');
  assert.equal(MARKER_COLORS[15], 'Cream');
});

test('snippet source: every snippet returns a table, iterates lists with #, and embeds escaped values', () => {
  for (const [name, code] of Object.entries(allSnippetSamples())) {
    assert.ok(/return (\{|r\n)/.test(code), `${name} returns a table`);
    assert.ok(!code.includes('pairs(items)') && !code.includes('pairs(clips)'), `${name} iterates lists with #`);
  }
  const clips = allSnippetSamples()['listClips'] ?? '';
  assert.ok(clips.includes('"Bin \\"one\\""') && clips.includes('"sub]]bin"'));
  const marker = allSnippetSamples()['addMarker'] ?? '';
  assert.ok(marker.includes('"name \\"q\\"\\n"') && marker.includes('"note\\\\"'));
});

// Stub Resolve objects (plain tables with colon-callable methods) in two states: no project open,
// and a project open with no current timeline, no timelines, no clips, no render jobs.
const STUB_LUA = `local function stub_env(with_project)
  local folder = { GetName = function() return "Master" end, GetUniqueId = function() return "f1" end,
    GetClipList = function() return {} end, GetSubFolderList = function() return {} end }
  local mp = { GetRootFolder = function() return folder end, GetCurrentFolder = function() return folder end }
  local project = { GetName = function() return "Demo" end, GetUniqueId = function() return "p1" end,
    GetSettings = function() return { timelineFrameRate = 24, timelineResolutionWidth = "1920", timelineResolutionHeight = "1080" } end,
    GetMediaPool = function() return mp end, GetTimelineCount = function() return 0 end,
    GetTimelineByIndex = function() return nil end, GetCurrentTimeline = function() return nil end,
    GetRenderPresetList = function() return {} end, GetRenderJobList = function() return {} end,
    GetRenderJobStatus = function() return {} end, IsRenderingInProgress = function() return false end }
  local pm = { GetCurrentProject = function() return with_project and project or nil end,
    GetProjectListInCurrentFolder = function() return { "p" } end,
    GetProjectAttributesInCurrentFolder = function() return {} end,
    GetCurrentFolder = function() return "root" end, GetCurrentDatabase = function() return { DbType = "Disk" } end,
    SaveProject = function() return true end, LoadProject = function() return nil end }
  local resolve = { GetProjectManager = function() return pm end, GetProductName = function() return "DaVinci Resolve" end,
    GetVersionString = function() return "21.1.0.17" end, IsStudio = function() return false end,
    GetCurrentPage = function() return "edit" end }
  return setmetatable({ resolve = resolve }, { __index = _G })
end
local function run(name, envname, with_project, code)
  local f = assert(loadstring(code, "=" .. name))
  setfenv(f, stub_env(with_project))
  local ok, r = pcall(f)
  local okv = ok and type(r) == "table" and tostring(r.ok) or ("call failed: " .. tostring(r))
  local err = ok and type(r) == "table" and tostring(r.error) or ""
  print(name .. "\\t" .. envname .. "\\t" .. okv .. "\\t" .. err)
end
`;

interface Expect {
  noProject: [ok: string, error: RegExp];
  noTimeline: [ok: string, error: RegExp];
}
const NO_PROJECT: [string, RegExp] = ['false', /^no project is open/];
const NO_TIMELINE: [string, RegExp] = ['false', /^no current timeline/];
const OK: [string, RegExp] = ['true', /^nil$/];
const SNIPPET_EXPECTATIONS: Record<string, Expect> = {
  status: { noProject: OK, noTimeline: OK },
  projectInfo: { noProject: NO_PROJECT, noTimeline: OK },
  listProjects: { noProject: OK, noTimeline: OK },
  listTimelines: { noProject: NO_PROJECT, noTimeline: OK },
  listClips: { noProject: NO_PROJECT, noTimeline: ['false', /^bin not found: \/Bin "one"/] },
  listClipsRoot: { noProject: NO_PROJECT, noTimeline: OK },
  timelineItems: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  addMarker: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  deleteMarkers: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  deleteMarkersColor: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  setCurrentTimeline: { noProject: NO_PROJECT, noTimeline: ['false', /^unknown timeline: Timeline 1/] },
  openProject: { noProject: ['false', /^unknown project: My "Project"/], noTimeline: ['false', /^unknown project/] },
  openProjectNoSave: { noProject: ['false', /^LoadProject returned nil for p/], noTimeline: ['false', /^LoadProject returned nil for p/] },
  render: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  renderNoPreset: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  renderStatus: { noProject: NO_PROJECT, noTimeline: ['false', /^unknown render job: abc-123/] },
  captureInfo: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
  captureRun: { noProject: NO_PROJECT, noTimeline: NO_TIMELINE },
};

test('every tool snippet run under fuscript against stub objects returns the expected ok/error', NEEDS_FUSCRIPT, async () => {
  const dirs = await makeTempDirs();
  try {
    const samples = allSnippetSamples();
    assert.deepEqual(Object.keys(samples).sort(), Object.keys(SNIPPET_EXPECTATIONS).sort(), 'every sample has an expectation');
    const lines = [STUB_LUA];
    for (const [name, code] of Object.entries(samples)) {
      lines.push(`run("${name}", "noProject", false, ${luaLongBracket(code)})`);
      lines.push(`run("${name}", "noTimeline", true, ${luaLongBracket(code)})`);
    }
    const file = path.join(dirs.root, 'snippets.lua');
    await fsp.writeFile(file, lines.join('\n'));
    const out = await runFuscript(file);
    const rows = out.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t'));
    assert.equal(rows.length, Object.keys(samples).length * 2, out);
    for (const [name, envName, ok, error] of rows) {
      const expect = SNIPPET_EXPECTATIONS[name ?? ''];
      assert.ok(expect, `unexpected snippet ${name}`);
      const [wantOk, wantErr] = envName === 'noProject' ? expect.noProject : expect.noTimeline;
      assert.equal(ok, wantOk, `${name} (${envName}) ok: ${error}`);
      assert.match(error ?? '', wantErr, `${name} (${envName}) error`);
    }
  } finally {
    await dirs.cleanup();
  }
});

test('every tool snippet compiles under fuscript (LuaJIT syntax check)', NEEDS_FUSCRIPT, async () => {
  const dirs = await makeTempDirs();
  try {
    const samples = allSnippetSamples();
    const lines = ['local results = {}'];
    for (const [name, code] of Object.entries(samples)) {
      lines.push(`do local f, err = loadstring(${luaLongBracket(code)}, "=${name}"); results[#results + 1] = "${name}: " .. (f and "ok" or ("FAIL " .. tostring(err))) end`);
    }
    lines.push('for i = 1, #results do print(results[i]) end');
    const file = path.join(dirs.root, 'syntax.lua');
    await fsp.writeFile(file, lines.join('\n'));
    const out = await runFuscript(file);
    const failed = out.split('\n').filter((l) => l.includes('FAIL'));
    assert.deepEqual(failed, [], out);
    assert.equal(out.split('\n').filter((l) => l.endsWith(': ok')).length, Object.keys(samples).length);
  } finally {
    await dirs.cleanup();
  }
});

// ---- capture_frame's two chunks, against fuller stubs -------------------------------------------

/**
 * Run `lua` under fuscript with the bridge's own JSON encoder loaded (the bridge in its testing
 * mode): each `emit(name, value)` becomes an entry of the result, parsed from the JSON the server
 * would receive, so an empty Lua table arrives as `{}` here too.
 */
async function runEmitting(lua: string): Promise<Record<string, unknown>> {
  const dirs = await makeTempDirs();
  try {
    const bridge = path.join(repoRoot(), 'bridge', 'resolve_mcp_bridge.lua');
    const file = path.join(dirs.root, 'emit.lua');
    const head = [
      `local M = assert(loadfile(${luaString(bridge)}))("RLB_BRIDGE_TESTING")`,
      'local function emit(name, v) print("EMIT\\t" .. name .. "\\t" .. M.json(v)) end',
      'local function run_with(name, env, st, code)',
      '  local f = assert(loadstring(code, "=" .. name))',
      '  setfenv(f, env)',
      '  local ok, r = pcall(f)',
      '  emit(name, { result = ok and r or { call_failed = tostring(r) }, state = st })',
      'end',
    ];
    await fsp.writeFile(file, [...head, lua].join('\n'));
    const out = await runFuscript(file);
    const got: Record<string, unknown> = {};
    for (const line of out.split('\n')) {
      const [tag, name, json] = line.split('\t');
      if (tag === 'EMIT' && name !== undefined && json !== undefined) got[name] = JSON.parse(json);
    }
    return got;
  } finally {
    await dirs.cleanup();
  }
}

/** A Lua table literal for flat options (strings, numbers, booleans). */
function luaOptions(o: Record<string, string | number | boolean>): string {
  return `{ ${Object.entries(o)
    .map(([k, v]) => `${k} = ${typeof v === 'string' ? luaString(v) : String(v)}`)
    .join(', ')} }`;
}

interface Emitted {
  result: Record<string, unknown>;
  state: Record<string, unknown>;
}

function emitted(all: Record<string, unknown>, name: string): Emitted {
  const e = all[name] as Emitted | undefined;
  assert.ok(e, `no output for ${name}`);
  assert.equal(e.result['call_failed'], undefined, `${name} raised: ${String(e.result['call_failed'])}`);
  return e;
}

// Chunk B's fake Resolve: a page and a playhead that move as the API is called. The playhead reads
// nil on Fusion and Media (measured); options make one export throw, return false, or be followed
// by a lying read-back, make OpenPage fail, report a render, or change the start timecode.
const CAPTURE_RUN_STUB = String.raw`
local function capture_env(o)
  local st = { page = o.page, tc = o.tc, opened = {}, sets = {}, exports = {} }
  local lie_next = false
  local tl = {
    GetUniqueId = function() return "tl-1" end,
    GetStartFrame = function() return 108000 end,
    GetStartTimecode = function() return o.start_tc or "01:00:00:00" end,
    GetCurrentTimecode = function()
      if st.page == "fusion" or st.page == "media" then return nil end
      if lie_next then lie_next = false; return "23:59:59:29" end
      return st.tc
    end,
    SetCurrentTimecode = function(_, tc) st.sets[#st.sets + 1] = tc; st.tc = tc; return true end,
  }
  local project = {
    GetCurrentTimeline = function() return tl end,
    IsRenderingInProgress = function() return o.rendering == true end,
    ExportCurrentFrameAsStill = function(_, p)
      local n = #st.exports + 1
      st.exports[n] = { path = p, tc = st.tc, page = st.page }
      if o.throw_on == n then error("export blew up") end
      lie_next = (o.lie_on == n)
      return o.fail_on ~= n
    end,
  }
  local pm = { GetCurrentProject = function() return project end }
  local resolve = {
    GetProjectManager = function() return pm end,
    GetCurrentPage = function() return st.page end,
    OpenPage = function(_, p)
      st.opened[#st.opened + 1] = p
      if o.open_fails then return false end
      st.page = p
      return true
    end,
  }
  return setmetatable({ resolve = resolve }, { __index = _G }), st
end
local function run_capture(name, o, code)
  local env, st = capture_env(o)
  run_with(name, env, st, code)
end
`;

test('capture chunk B switches to Color, captures each shot at its timecode, and puts the playhead and page back', NEEDS_FUSCRIPT, async () => {
  const TL = { timelineId: 'tl-1', startFrame: 108000, startTimecode: '01:00:00:00' };
  const shots = (...tcs: string[]) => tcs.map((timecode, i) => ({ path: `/tmp/state "dir"/capture-7-0a1b2c3d-${i + 1}.bmp`, timecode }));
  const cases: Record<string, [Record<string, string | number | boolean>, string[]]> = {
    fromFusion: [{ page: 'fusion', tc: '01:00:02:00' }, ['01:00:08:08', '01:00:09:00']],
    fromColor: [{ page: 'color', tc: '01:00:02:00' }, ['01:00:08:08']],
    playheadAfterFrame: [{ page: 'edit', tc: '01:00:02:00' }, ['01:00:08:08', '']],
    lyingReadback: [{ page: 'edit', tc: '01:00:02:00', lie_on: 2 }, ['01:00:08:08', '01:00:09:00', '01:00:10:00']],
    exportThrows: [{ page: 'cut', tc: '01:00:02:00', throw_on: 2 }, ['01:00:08:08', '01:00:09:00', '01:00:10:00']],
    exportFalse: [{ page: 'color', tc: '01:00:02:00', fail_on: 1 }, ['01:00:08:08', '01:00:09:00']],
    playheadUnreadable: [{ page: 'color' }, ['01:00:08:08', '']],
    changed: [{ page: 'fusion', tc: '01:00:02:00', start_tc: '00:59:59:00' }, ['01:00:08:08']],
    rendering: [{ page: 'deliver', tc: '01:00:02:00', rendering: true }, ['01:00:08:08']],
    openFails: [{ page: 'fusion', tc: '01:00:02:00', open_fails: true }, ['01:00:08:08']],
  };
  const lua = [CAPTURE_RUN_STUB];
  for (const [name, [opts, tcs]] of Object.entries(cases)) {
    lua.push(`run_capture("${name}", ${luaOptions(opts)}, ${luaLongBracket(captureRunSnippet({ ...TL, shots: shots(...tcs) }))})`);
  }
  const all = await runEmitting(lua.join('\n'));
  const exportsOf = (e: Emitted) => (Array.isArray(e.state['exports']) ? (e.state['exports'] as Array<Record<string, unknown>>) : []);

  // From Fusion (the playhead is unreadable there): switch, capture on Color, restore both.
  const fusion = emitted(all, 'fromFusion');
  assert.deepEqual(fusion.result, {
    ok: true,
    page: { was: 'fusion', switched: true, restored: true },
    playhead: { was: '01:00:02:00', restored: true },
    shots: [
      { ok: true, timecode: '01:00:08:08' },
      { ok: true, timecode: '01:00:09:00' },
    ],
  });
  assert.deepEqual(exportsOf(fusion), [
    { path: '/tmp/state "dir"/capture-7-0a1b2c3d-1.bmp', tc: '01:00:08:08', page: 'color' },
    { path: '/tmp/state "dir"/capture-7-0a1b2c3d-2.bmp', tc: '01:00:09:00', page: 'color' },
  ]);
  assert.deepEqual(fusion.state['opened'], ['color', 'fusion']);
  assert.equal(fusion.state['page'], 'fusion');
  assert.equal(fusion.state['tc'], '01:00:02:00');

  // Already on Color: no page change at all.
  const color = emitted(all, 'fromColor');
  assert.deepEqual(color.result['page'], { was: 'color', switched: false, restored: true });
  assert.deepEqual(color.state['opened'], {}, 'no OpenPage call (an empty Lua table arrives as {})');

  // A playhead shot after a numbered shot captures the original playhead, not where the first shot left it.
  const ph = emitted(all, 'playheadAfterFrame');
  assert.deepEqual(exportsOf(ph).map((x) => x['tc']), ['01:00:08:08', '01:00:02:00']);
  assert.deepEqual((ph.result['shots'] as unknown[])[1], { ok: true, timecode: '01:00:02:00' });

  // A read-back that disagrees drops exactly that shot.
  const lie = emitted(all, 'lyingReadback');
  const lieShots = lie.result['shots'] as Array<Record<string, unknown>>;
  assert.deepEqual(lieShots.map((s) => s['ok']), [true, false, true]);
  assert.equal(lieShots[1]!['error'], 'the playhead read back as 23:59:59:29, not 01:00:09:00; the frame was dropped');
  assert.equal(lieShots[1]!['readback'], '23:59:59:29');

  // An export that throws fails its shot only; later shots run and both restores still happen.
  const thrown = emitted(all, 'exportThrows');
  const thrownShots = thrown.result['shots'] as Array<Record<string, unknown>>;
  assert.deepEqual(thrownShots.map((s) => s['ok']), [true, false, true]);
  assert.match(String(thrownShots[1]!['error']), /^Lua error: .*export blew up/);
  assert.deepEqual(thrown.result['page'], { was: 'cut', switched: true, restored: true });
  assert.deepEqual(thrown.result['playhead'], { was: '01:00:02:00', restored: true });
  assert.equal(thrown.state['page'], 'cut');
  assert.equal(thrown.state['tc'], '01:00:02:00');

  const falseExport = emitted(all, 'exportFalse');
  assert.deepEqual((falseExport.result['shots'] as unknown[])[0], {
    ok: false,
    timecode: '01:00:08:08',
    readback: '01:00:08:08',
    error: 'ExportCurrentFrameAsStill returned false',
  });

  // No playhead to read: the playhead shot fails, the numbered one works, nothing to restore.
  const unreadable = emitted(all, 'playheadUnreadable');
  assert.deepEqual(unreadable.result['shots'], [
    { ok: true, timecode: '01:00:08:08' },
    { ok: false, error: 'the playhead could not be read' },
  ]);
  assert.deepEqual(unreadable.result['playhead'], { restored: false });

  // Refusals come before anything moves.
  for (const [name, error] of [
    ['changed', /^the current timeline changed after the frames were worked out; call capture_frame again$/],
    ['rendering', /^a render is in progress/],
    ['openFails', /^OpenPage\("color"\) returned false; open the Color page in Resolve/],
  ] as const) {
    const e = emitted(all, name);
    assert.equal(e.result['ok'], false, name);
    assert.match(String(e.result['error']), error, name);
    assert.deepEqual(e.state['exports'], {}, `${name}: nothing exported`);
    assert.deepEqual(e.state['sets'], {}, `${name}: the playhead never moved`);
  }
  assert.equal(emitted(all, 'changed').result['changed'], true);
  assert.deepEqual(emitted(all, 'changed').state['opened'], {}, 'a changed timeline is refused before the page switch');
  assert.deepEqual(emitted(all, 'openFails').state['opened'], ['color']);
});

// Chunk A's fake timeline: markers under unsorted keys, plus a non-marker value and a string key
// holding a table (table.sort would fail on a mixed key list); two video tracks of items.
const CAPTURE_INFO_STUB = String.raw`
local function info_env()
  local st = { listed = {} }
  local function item(id, name, s, e)
    return { GetUniqueId = function() return id end, GetName = function() return name end,
      GetStart = function() return s end, GetEnd = function() return e end }
  end
  local tracks = {
    { item("item-1", "Shot A", 108000, 108100) },
    { item("item-2", "Shot B", 108050, 108200), item("item-3", "Shot C", 108200, 108300) },
  }
  local markers = {
    [300] = { color = "Blue", name = string.rep("a", 99) .. "\195\169" .. "tail", note = "not returned", duration = 1 },
    [10] = { color = "Blue", name = "Intro 100% .* x" },
    [400] = { color = "Red", name = "100%" },
    [150] = { color = "Blue", name = "INTRO again" },
    [250] = { color = "Green", name = "" },
    [20] = { color = "Red", name = "red one" },
    [500] = "not a marker",
    __flags = { odd = true },
  }
  local tl = {
    GetName = function() return "Timeline 1" end, GetUniqueId = function() return "tl-1" end,
    GetStartFrame = function() return 108000 end, GetEndFrame = function() return 108497 end,
    GetStartTimecode = function() return "01:00:00:00" end,
    GetSettings = function() return { timelineFrameRate = 29.97, timelineDropFrameTimecode = "0" } end,
    GetMarkers = function() return markers end,
    GetTrackCount = function(_, kind) return kind == "video" and #tracks or 0 end,
    GetItemListInTrack = function(_, kind, i) st.listed[#st.listed + 1] = i; return tracks[i] end,
  }
  local project = { GetCurrentTimeline = function() return tl end }
  local pm = { GetCurrentProject = function() return project end }
  local resolve = { GetProjectManager = function() return pm end }
  return setmetatable({ resolve = resolve }, { __index = _G }), st
end
local function run_info(name, code)
  local env, st = info_env()
  run_with(name, env, st, code)
end
`;

test('capture chunk A: one marker set per query in frame order, a shared budget, clipped names, items in request order', NEEDS_FUSCRIPT, async () => {
  const info = (itemIds: string[], markerQueries: MarkerQuery[], markerBudget = 40) => captureInfoSnippet({ itemIds, markerQueries, markerBudget });
  const cases: Record<string, string> = {
    queries: info([], [{ color: 'Blue' }, { contains: 'INTRO' }, { contains: '0% .*' }, { color: 'Red', contains: 'zzz' }, { contains: 'TAIL' }]),
    budget: info([], [{ color: 'Blue' }, { contains: 'intro' }], 4),
    items: info(['item-2', 'missing "id"', 'item-1'], []),
    firstTrackOnly: info(['item-1'], []),
  };
  const lua = [CAPTURE_INFO_STUB, ...Object.entries(cases).map(([name, code]) => `run_info("${name}", ${luaLongBracket(code)})`)];
  const all = await runEmitting(lua.join('\n'));

  const mk = (offset: number, color: string, name: string) => ({ offset, frame: 108000 + offset, color, name });
  const clipped = `${'a'.repeat(99)}...`;
  const q = emitted(all, 'queries').result;
  assert.deepEqual(q['timeline'], { name: 'Timeline 1', unique_id: 'tl-1', start_frame: 108000, end_frame: 108497, start_timecode: '01:00:00:00' });
  assert.equal(q['frame_rate'], 29.97);
  assert.equal(q['drop_frame'], '0');
  assert.deepEqual(q['marker_sets'], [
    { markers: [mk(10, 'Blue', 'Intro 100% .* x'), mk(150, 'Blue', 'INTRO again'), mk(300, 'Blue', clipped)], total: 3 },
    { markers: [mk(10, 'Blue', 'Intro 100% .* x'), mk(150, 'Blue', 'INTRO again')], total: 2 },
    { markers: [mk(10, 'Blue', 'Intro 100% .* x')], total: 1 }, // "%" and ".*" are literal, so "100%" is no match
    { markers: {}, total: 0 },
    { markers: [mk(300, 'Blue', clipped)], total: 1 }, // matched on the whole name, past the clip
  ]);
  assert.deepEqual(q['items'], {});
  assert.deepEqual(q['missing_items'], {});
  assert.deepEqual(emitted(all, 'queries').state['listed'], {}, 'no ids, no track scan');

  // 99 ASCII bytes then a 2-byte character: the cut backs up to byte 99 rather than split it.
  assert.equal(Buffer.byteLength(clipped), 102);

  // The budget runs out inside the second set; its total still counts every match.
  assert.deepEqual(emitted(all, 'budget').result['marker_sets'], [
    { markers: [mk(10, 'Blue', 'Intro 100% .* x'), mk(150, 'Blue', 'INTRO again'), mk(300, 'Blue', clipped)], total: 3 },
    { markers: [mk(10, 'Blue', 'Intro 100% .* x')], total: 2 },
  ]);

  const items = emitted(all, 'items');
  assert.deepEqual(items.result['items'], [
    { id: 'item-2', name: 'Shot B', start: 108050, end: 108200, track: 2 },
    { id: 'item-1', name: 'Shot A', start: 108000, end: 108100, track: 1 },
  ]);
  assert.deepEqual(items.result['missing_items'], ['missing "id"']);
  assert.deepEqual(items.result['marker_sets'], {}, 'no markers targets, no sets');
  assert.deepEqual(items.state['listed'], [1, 2]);

  assert.deepEqual(emitted(all, 'firstTrackOnly').state['listed'], [1], 'the scan stops once every id is found');
});
