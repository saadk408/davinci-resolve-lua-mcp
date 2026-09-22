import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { decodeHex, extractResp, extractSessionHex, findPrefsFile, parseEnvelope, parseSession } from '../src/prefs.js';
import { hex, renderPrefs } from './helpers/fakeBridge.js';
import { makeTempDirs, sleep } from './helpers/tmp.js';

const ENVELOPE = { v: 1, id: 'abc', session: 's1', op: 'run', ok: true, ms: 3, prints: [], result: { a: 1 }, bridge: 'resolve_mcp_bridge v0.1.0' };

test('extractResp finds the value despite hash order, hostile neighbours and a near-miss key', () => {
  const text = renderPrefs({ RLBResp: `abc:${hex(JSON.stringify(ENVELOPE))}`, RLBSession: hex('{"session":"s1","state":"running"}') });
  assert.ok(text.includes('RLBRespX = "near:6d697373"'));
  assert.ok(text.includes('brackets]] dashes-- utf8 é 日本 end'));
  const r = extractResp(text);
  assert.ok(r);
  assert.equal(r.id, 'abc');
  assert.deepEqual(JSON.parse(decodeHex(r.hex)), ENVELOPE);
  assert.equal(extractSessionHex(text), hex('{"session":"s1","state":"running"}'));
});

test('extractResp takes the last complete match and ignores a half-written line', () => {
  const two = `\t\t\tRLBResp = "old:7b7d",\n\t\t\tRLBResp = "new:5b5d",\n`;
  assert.deepEqual(extractResp(two), { id: 'new', hex: '5b5d' });
  const half = renderPrefs({ RLBResp: 'abc:7b22', RLBSession: '' }, { unterminated: true });
  assert.equal(extractResp(half), undefined);
  assert.equal(extractResp(renderPrefs({ RLBResp: '', RLBSession: '' })), undefined);
  assert.deepEqual(extractResp('RLBResp = "nocolon"'), { id: 'nocolon', hex: '' });
  assert.equal(extractResp('xRLBResp = "abc:7b7d"'), undefined, 'word boundary');
  assert.equal(extractSessionHex(renderPrefs({ RLBResp: '', RLBSession: '' })), '');
});

test('decodeHex rejects odd length and non-hex, and decodes UTF-8', () => {
  assert.equal(decodeHex(hex('é日本 "q"')), 'é日本 "q"');
  assert.equal(decodeHex(''), '');
  assert.throws(() => decodeHex('abc'), /odd length/);
  assert.throws(() => decodeHex('zz'), /non-hex/);
});

test('parseEnvelope validates the envelope and normalises result', () => {
  const env = parseEnvelope(hex(JSON.stringify(ENVELOPE)));
  assert.equal(env.ok, true);
  assert.deepEqual(env.result, { a: 1 });
  const tableError = parseEnvelope(hex(JSON.stringify({ ...ENVELOPE, ok: false, error: { code: 1 }, result: null })));
  assert.deepEqual(tableError.error, { code: 1 });
  assert.equal(tableError.result, null);
  const noResult = parseEnvelope(hex(JSON.stringify({ v: 1, id: 'x', session: '', op: '', ok: false, error: 'SetPrefs: boom', bridge: 'b' })));
  assert.equal(noResult.result, null);
  assert.throws(() => parseEnvelope(hex('{"v":1')), /not valid JSON/);
  assert.throws(() => parseEnvelope(hex(JSON.stringify({ v: 2, id: 'x', session: '', op: '', ok: true, bridge: 'b' }))), /malformed/);
  assert.throws(() => parseEnvelope(hex(JSON.stringify({ v: 1, id: 'x' }))), /malformed/);
  assert.throws(() => parseEnvelope(hex('[1,2]')), /malformed/);
});

test('parseSession accepts the bridge record and its error variant', () => {
  const s = parseSession(hex(JSON.stringify({ v: 1, session: 'abc', pid: 12, started: 1, state: 'running', bridge: 'b', state_dir: '/x', state_dir_source: 'stamp' })));
  assert.equal(s.state, 'running');
  assert.equal(s.pid, 12);
  const e = parseSession(hex(JSON.stringify({ v: 1, session: 'abc', pid: 12, started: 1, state: 'error', error: 'no state directory' })));
  assert.equal(e.error, 'no state directory');
  assert.throws(() => parseSession(hex(JSON.stringify({ session: 'abc', state: 'weird' }))), /malformed/);
});

test('findPrefsFile picks the newest profile and tolerates a missing directory', async () => {
  const dirs = await makeTempDirs();
  try {
    assert.equal(await findPrefsFile(path.join(dirs.root, 'missing')), undefined);
    assert.equal(await findPrefsFile(dirs.prefsDir), undefined);
    await fsp.mkdir(path.join(dirs.prefsDir, 'Old'));
    await fsp.writeFile(path.join(dirs.prefsDir, 'Old', 'Fusion.prefs'), '{}');
    await fsp.writeFile(path.join(dirs.prefsDir, 'stray.txt'), 'x');
    await sleep(15);
    await fsp.mkdir(path.join(dirs.prefsDir, 'Default'));
    await fsp.writeFile(path.join(dirs.prefsDir, 'Default', 'Fusion.prefs'), '{}');
    const found = await findPrefsFile(dirs.prefsDir);
    assert.equal(found?.path, path.join(dirs.prefsDir, 'Default', 'Fusion.prefs'));
  } finally {
    await dirs.cleanup();
  }
});

test('a CRLF prefs file parses like an LF one, and a CR before the closing quote is a torn line', () => {
  const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
  const lf = renderPrefs({ RLBResp: `abc:${hex(JSON.stringify(ENVELOPE))}`, RLBSession: hex('{"session":"s1","state":"running"}') });
  assert.deepEqual(extractResp(crlf(lf)), extractResp(lf));
  assert.equal(extractSessionHex(crlf(lf)), extractSessionHex(lf));
  const half = renderPrefs({ RLBResp: 'abc:7b22', RLBSession: '' }, { unterminated: true });
  assert.equal(extractResp(crlf(half)), undefined);
  assert.equal(extractResp('RLBResp = "abc:7b\r22"'), undefined);
});
