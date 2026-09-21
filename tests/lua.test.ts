import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  allSnippetSamples,
  formatRequest,
  ID_RE,
  longBracketLevel,
  luaInt,
  luaLongBracket,
  luaString,
  luaStringList,
  MARKER_COLORS,
  SESSION_RE,
} from '../src/lua.js';
import { makeTempDirs } from './helpers/tmp.js';
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
