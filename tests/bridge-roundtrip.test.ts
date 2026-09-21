// The real bridge's request loader against a request file the server wrote: the only test that
// proves the long-bracket level choice, because it uses Lua's own lexer (under fuscript).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { formatRequest } from '../src/lua.js';
import { makeTempDirs, repoRoot } from './helpers/tmp.js';
import { NEEDS_FUSCRIPT, runFuscript } from './lua.test.js';

const HOSTILE_CODE = [
  '-- ]] and ]==] and ]===] inside the code',
  'local s = "quotes \\" and \'single\' and backslash \\\\"',
  'local t = { "tab\there", "utf8 é 日本 😀", [[long ]] }',
  'local c = "\\0\\1\\31\\127 control bytes as escapes"',
  'return { ok = true, s = s, n = #t }',
  '',
].join('\n');

test('the bridge loads and validates a server-written request byte for byte', NEEDS_FUSCRIPT, async () => {
  const dirs = await makeTempDirs();
  try {
    const request = path.join(dirs.stateDir, 'next.lua');
    await fsp.writeFile(request, formatRequest({ id: 'roundtrip01', session: 'sess-abc', op: 'run', ts: 1758412345, maxKb: 96, code: HOSTILE_CODE }), 'utf8');
    const bridge = path.join(repoRoot(), 'bridge', 'resolve_lua_bridge.lua');
    const script = [
      `local M = assert(loadfile(${JSON.stringify(bridge)}))("RLB_BRIDGE_TESTING")`,
      `local req, err = M.load_request(${JSON.stringify(request)})`,
      'if not req then print("LOAD_FAIL " .. tostring(err)) return end',
      'local ok, verr = M.validate_request(req)',
      'print("VALID " .. tostring(ok) .. " " .. tostring(verr))',
      'print("ID " .. tostring(req.id))',
      'print("SESSION " .. tostring(req.session))',
      'print("OP " .. tostring(req.op))',
      'print("TS " .. tostring(req.ts))',
      'print("MAXKB " .. tostring(M.request_max_kb(req)))',
      'print("CODEHEX " .. M.hex(req.code))',
      'local f, cerr = loadstring(req.code, "=request")',
      'print("COMPILES " .. tostring(f ~= nil) .. " " .. tostring(cerr))',
    ].join('\n');
    const file = path.join(dirs.root, 'roundtrip.lua');
    await fsp.writeFile(file, script);
    const out = await runFuscript(file);
    const line = (tag: string): string => {
      const m = out.split('\n').find((l) => l.startsWith(`${tag} `));
      assert.ok(m, `missing ${tag} in:\n${out}`);
      return m.slice(tag.length + 1);
    };
    assert.equal(line('VALID'), 'true nil');
    assert.equal(line('ID'), 'roundtrip01');
    assert.equal(line('SESSION'), 'sess-abc');
    assert.equal(line('OP'), 'run');
    assert.equal(line('TS'), '1758412345');
    assert.equal(line('MAXKB'), '96');
    assert.equal(Buffer.from(line('CODEHEX'), 'hex').toString('utf8'), HOSTILE_CODE);
    assert.equal(line('COMPILES'), 'true nil');
  } finally {
    await dirs.cleanup();
  }
});
