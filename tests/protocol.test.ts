import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { BridgeClient, BridgeError, LOCK_FILE, REQUEST_FILE } from '../src/protocol.js';
import { hex, startFakeBridge, type FakeBridge, type FakeBridgeOptions } from './helpers/fakeBridge.js';
import { exists, makeTempDirs, sleep, waitFor, type TempDirs } from './helpers/tmp.js';

interface Rig {
  dirs: TempDirs;
  fake: FakeBridge;
  client: BridgeClient;
  close(): Promise<void>;
}

async function rig(opts: Partial<FakeBridgeOptions> = {}, clientOpts: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {}): Promise<Rig> {
  const dirs = await makeTempDirs();
  const fake = await startFakeBridge({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, ...opts });
  const client = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pollMs: 5, pingTimeoutMs: 400, ...clientOpts });
  return {
    dirs,
    fake,
    client,
    close: async () => {
      fake.stop();
      client.releaseLockSync();
      await dirs.cleanup();
    },
  };
}

async function expectError(p: Promise<unknown>, kind: string): Promise<BridgeError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof BridgeError, `expected BridgeError, got ${String(err)}`);
    assert.equal(err.kind, kind, err.text);
    return err;
  }
  assert.fail(`expected a ${kind} error`);
}

test('happy path: run, ping and stop, with the slot cleaned up and stop leaving the session stopped', async () => {
  const r = await rig();
  try {
    const env = await r.client.run('return 1 + 1', 1000);
    assert.equal(env.ok, true);
    assert.deepEqual(env.result, { ok: true, echo: 'return 1 + 1' });
    assert.equal(r.fake.requests[0]?.session, r.fake.session, 'run carries the exact session');
    assert.ok(Math.abs((r.fake.requests[0]?.ts ?? 0) - Date.now() / 1000) < 5, 'ts is now');
    assert.equal(r.fake.requests[0]?.max_kb, 64);
    assert.equal(await exists(path.join(r.dirs.stateDir, REQUEST_FILE)), false, 'next.lua deleted after the response');

    const ping = await r.client.ping();
    assert.equal(ping.ok, true);
    assert.equal(r.fake.requests[1]?.session, '*', 'ping sends "*"');
    assert.equal(r.fake.requests[1]?.op, 'ping');

    const stop = await r.client.stop();
    assert.equal(stop.ok, true);
    assert.equal(r.fake.requests[2]?.session, '*', 'stop sends "*"');
    const after = await expectError(r.client.ping(), 'stopped');
    assert.match(after.text, /stopped at/);
    const status = await r.client.status();
    assert.equal(status.alive, false);
    assert.equal(status.reason, 'stopped');
  } finally {
    await r.close();
  }
});

test('status() reports alive with the ping result and the state-dir match', async () => {
  const r = await rig();
  try {
    const s = await r.client.status();
    assert.equal(s.alive, true, s.detail);
    assert.equal(s.reason, undefined);
    assert.equal(s.session?.session, r.fake.session);
    assert.equal(s.pid_alive, true);
    assert.equal(s.state_dir_match, true);
    assert.equal(s.lock.owned, false, 'the lock is never held while idle');
    assert.equal(s.lock.holder_pid, undefined);
    assert.equal((s.ping as { product: string }).product, 'DaVinci Resolve');
    assert.ok(typeof s.ping_ms === 'number');
  } finally {
    await r.close();
  }
});

test('a bridge with a different state dir is flagged', async () => {
  const r = await rig({ bridgeStateDir: '/somewhere/else' });
  try {
    const s = await r.client.status();
    assert.equal(s.alive, true);
    assert.equal(s.state_dir_match, false);
  } finally {
    await r.close();
  }
});

test('timeout deletes the slot and names the id and both causes; a late answer is ignored', async () => {
  const r = await rig({ mode: 'late', lateMs: 150 });
  try {
    const err = await expectError(r.client.run('return 1', 60), 'timeout');
    const id = r.fake.requests[0]?.id ?? '';
    assert.ok(id.length === 32 && err.message.includes(id), err.message);
    assert.match(err.text, /busy on a long synchronous call/);
    assert.match(err.text, /Workspace > Scripts > resolve_lua_bridge/);
    assert.equal(await exists(path.join(r.dirs.stateDir, REQUEST_FILE)), false);
    await sleep(200); // the late answer for the old id lands now
    const s = await r.client.status();
    assert.equal(s.alive, true, 'the next request ignores the old id and gets its own answer');
    assert.notEqual(r.fake.requests[1]?.id, id);
  } finally {
    await r.close();
  }
});

test('never started, stopped, error and dead-pid sessions are distinct reasons and write no request', async () => {
  const dirs = await makeTempDirs();
  try {
    const client = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pollMs: 5, pingTimeoutMs: 200 });
    let s = await client.status();
    assert.equal(s.reason, 'prefs_missing');

    const fake = await startFakeBridge({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, mode: 'silent' });
    await fake.writeRaw('');
    await fsp.writeFile(fake.prefsPath, (await fsp.readFile(fake.prefsPath, 'utf8')).replace(/RLBSession = "[^"]*"/, 'RLBSession = ""'));
    s = await client.status();
    assert.equal(s.reason, 'never_started');
    assert.match(s.detail ?? '', /never started/);
    await expectError(client.run('return 1', 100), 'never_started');
    assert.equal(fake.requests.length, 0, 'no request written');

    await fake.writeSession('stopped', { stopped: 1758412345 });
    s = await client.status();
    assert.equal(s.reason, 'stopped');
    await expectError(client.run('return 1', 100), 'stopped');

    await fake.writeSession('error');
    s = await client.status();
    assert.equal(s.reason, 'bridge_error');
    assert.match(s.detail ?? '', /fake start failure/);

    fake.stop();
    const dead = await startFakeBridge({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, pid: 2147483000, mode: 'silent' });
    s = await client.status();
    assert.equal(s.reason, 'resolve_gone');
    assert.equal(s.pid_alive, false);
    await expectError(client.run('return 1', 100), 'resolve_gone');
    await expectError(client.stop(), 'resolve_gone');
    assert.equal(dead.requests.length, 0, 'nothing written for a dead bridge');
    dead.stop();
    client.releaseLockSync();
  } finally {
    await dirs.cleanup();
  }
});

test('no reply (live pid, silent bridge) is reported as no_reply', async () => {
  const r = await rig({ mode: 'silent' }, { pingTimeoutMs: 80 });
  try {
    const s = await r.client.status();
    assert.equal(s.alive, false);
    assert.equal(s.reason, 'no_reply');
    assert.equal(s.pid_alive, true);
  } finally {
    await r.close();
  }
});

test('a response for another id is ignored until ours arrives', async () => {
  const r = await rig({ mode: 'wrong_id' });
  try {
    const env = await r.client.run('return 2', 1000);
    assert.equal(env.ok, true);
    assert.equal(env.id, r.fake.requests[0]?.id);
  } finally {
    await r.close();
  }
});

test('a half-written prefs file keeps the poller waiting for the complete one', async () => {
  const r = await rig({ mode: 'half_written' });
  try {
    const env = await r.client.run('return 3', 1000);
    assert.equal(env.ok, true);
  } finally {
    await r.close();
  }
});

test('malformed hex and JSON for our id are bad_response errors that still free the slot', async () => {
  for (const mode of ['garbage_hex', 'garbage_json'] as const) {
    const r = await rig({ mode });
    try {
      const err = await expectError(r.client.run('return 1', 500), 'bad_response');
      assert.match(err.text, /cannot decode/);
      assert.equal(await exists(path.join(r.dirs.stateDir, REQUEST_FILE)), false);
    } finally {
      await r.close();
    }
  }
});

test('truncated envelopes, chunk errors and table errors pass through', async () => {
  const r = await rig({
    responder: (req) => {
      if (req.code?.includes('big')) return { ok: true, result: '{"a":"zzzz', truncated: true, result_bytes: 100_000, prints: [], ms: 2 };
      if (req.code?.includes('table')) return { ok: false, error: { code: 7 }, prints: ['before'], ms: 1 };
      return { ok: false, error: 'request:1: boom', prints: ['p1'], ms: 1 };
    },
  });
  try {
    const big = await r.client.run('big', 500);
    assert.equal(big.truncated, true);
    assert.equal(big.result_bytes, 100_000);
    const table = await r.client.run('table', 500);
    assert.deepEqual(table.error, { code: 7 });
    assert.deepEqual(table.prints, ['before']);
    const err = await r.client.run('plain', 500);
    assert.equal(err.ok, false);
    assert.equal(err.error, 'request:1: boom');
  } finally {
    await r.close();
  }
});

test('takeover: a bridge that exits silently looks like a timeout', async () => {
  const r = await rig({ mode: 'silent' });
  try {
    await expectError(r.client.run('return 1', 60), 'timeout');
  } finally {
    await r.close();
  }
});

test('the lock: a live holder blocks, a dead holder is taken over, and racing clients get exactly one owner', async () => {
  const dirs = await makeTempDirs();
  try {
    const lockPath = path.join(dirs.stateDir, LOCK_FILE);
    await fsp.writeFile(lockPath, `${process.pid}\n`); // "another server" that is alive (our own pid)
    const blocked = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pid: process.pid + 100000, isPidAlive: () => true, pingTimeoutMs: 100 });
    assert.equal(await blocked.acquireLock(), false);
    assert.equal(blocked.lock.holder_pid, process.pid);
    const t0 = Date.now();
    const err = await expectError(blocked.run('return 1', 50), 'lock_held');
    assert.ok(Date.now() - t0 >= 45, 'a live holder is waited for up to the request timeout');
    assert.match(err.text, new RegExp(`pid ${process.pid}`));
    assert.match(err.text, /RLB_STATE_DIR/);
    assert.equal(err.details['waited_ms'], 50);
    const s = await blocked.status();
    assert.equal(s.reason, 'prefs_missing', 'status looks at the prefs before it needs the lock');
    assert.equal(s.lock.path, lockPath);
    assert.equal(s.lock.holder_pid, process.pid, 'status reports the live holder on disk');
    assert.equal(await exists(lockPath), true, 'a live holder is never removed');

    await fsp.writeFile(lockPath, '2147483000\n'); // dead pid
    const taker = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64 });
    assert.equal(await taker.acquireLock(), true);
    assert.equal((await fsp.readFile(lockPath, 'utf8')).trim(), String(process.pid));
    taker.releaseLockSync();
    assert.equal(await exists(lockPath), false);

    await fsp.writeFile(lockPath, '2147483000\n');
    const racers = [1, 2, 3, 4].map((i) => new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pid: 900000 + i, isPidAlive: (p) => p >= 900000 && p < 1000000 }));
    const results = await Promise.all(racers.map((c) => c.acquireLock()));
    assert.equal(results.filter(Boolean).length, 1, `exactly one owner: ${JSON.stringify(results)}`);
    const owner = racers[results.indexOf(true)];
    assert.ok(owner);
    assert.equal(Number((await fsp.readFile(lockPath, 'utf8')).trim()), 900000 + results.indexOf(true) + 1);
    assert.equal(await exists(`${lockPath}.stale.900001`), false, 'stale files are cleaned up');
    for (const c of racers) c.releaseLockSync();
  } finally {
    await dirs.cleanup();
  }
});

test('the lock is taken per request: a busy slot is waited for and the lock is gone after every request', async () => {
  const r = await rig();
  try {
    const lockPath = path.join(r.dirs.stateDir, LOCK_FILE);
    assert.equal(await exists(lockPath), false, 'idle: no lock');
    const first = await r.client.run('return 1', 1000);
    assert.equal(first.ok, true);
    assert.equal(await exists(lockPath), false, 'released after the request');
    // A live holder (our own pid) that releases after 60 ms: the request waits, then proceeds.
    await fsp.writeFile(lockPath, `${process.pid + 100000}\n`);
    const waiter = new BridgeClient({ stateDir: r.dirs.stateDir, prefsDir: r.dirs.prefsDir, maxResponseKb: 64, pollMs: 5, isPidAlive: () => true });
    setTimeout(() => void fsp.unlink(lockPath), 60);
    const t0 = Date.now();
    const env = await waiter.run('return 2', 1000);
    assert.equal(env.ok, true);
    assert.ok(Date.now() - t0 >= 50, `waited for the holder (${Date.now() - t0} ms)`);
    assert.equal(await exists(lockPath), false, 'released again');
    assert.equal(r.fake.requests.length, 2);
    // A holder that never releases: status() keeps the session but reports lock_held after the ping wait.
    await fsp.writeFile(lockPath, `${process.pid + 100000}\n`);
    const stuck = new BridgeClient({ stateDir: r.dirs.stateDir, prefsDir: r.dirs.prefsDir, maxResponseKb: 64, pollMs: 5, pingTimeoutMs: 60, isPidAlive: () => true });
    const s = await stuck.status();
    assert.equal(s.reason, 'lock_held');
    assert.equal(s.lock.holder_pid, process.pid + 100000);
    assert.equal(s.session?.session, r.fake.session, 'the session is still reported');
    assert.equal(r.fake.requests.length, 2, 'no request was written while the slot was busy');
    await fsp.unlink(lockPath);
  } finally {
    await r.close();
  }
});

test('a leftover request file is removed at startup by the lock owner only', async () => {
  const dirs = await makeTempDirs();
  try {
    const leftover = path.join(dirs.stateDir, REQUEST_FILE);
    await fsp.writeFile(leftover, 'return { id = "diag" }');
    await fsp.writeFile(path.join(dirs.stateDir, LOCK_FILE), `${process.pid}\n`);
    const other = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pid: process.pid + 100000, isPidAlive: () => true });
    await other.acquireLock();
    assert.equal(await other.removeStaleRequest(), false);
    assert.equal(await exists(leftover), true, 'not touched while another live pid holds the lock');
    await fsp.unlink(path.join(dirs.stateDir, LOCK_FILE));
    const owner = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64 });
    await owner.acquireLock();
    assert.equal(await owner.removeStaleRequest(), true);
    assert.equal(await exists(leftover), false);
    owner.releaseLockSync();
  } finally {
    await dirs.cleanup();
  }
});

test('the response is found even when the bridge answers before the first poll', async () => {
  const r = await rig({ pollMs: 1 }, { pollMs: 50 });
  try {
    for (let i = 0; i < 3; i++) {
      const env = await r.client.run(`return ${i}`, 1000);
      assert.equal(env.ok, true);
    }
  } finally {
    await r.close();
  }
});

test('an unusable session token in RLBSession is a bridge_error, never spliced into a request', async () => {
  const r = await rig({ session: 'bad token!' });
  try {
    const err = await expectError(r.client.run('return 1', 100), 'bridge_error');
    assert.match(err.text, /unusable session token/);
    assert.equal(r.fake.requests.length, 0);
    const s = await r.client.status();
    assert.equal(s.reason, 'bridge_error');
  } finally {
    await r.close();
  }
});

test('requests are serialised through the in-process mutex', async () => {
  const r = await rig({ delayMs: 20 });
  try {
    const results = await Promise.all([r.client.run('a', 2000), r.client.run('b', 2000), r.client.ping()]);
    assert.deepEqual(results.map((e) => e.ok), [true, true, true]);
    assert.deepEqual(r.fake.requests.map((q) => q.op), ['run', 'run', 'ping']);
    await waitFor(() => exists(path.join(r.dirs.stateDir, REQUEST_FILE)).then((x) => !x));
  } finally {
    await r.close();
  }
});

test('the session written by a bridge is re-read on every request (never cached)', async () => {
  const r = await rig({ session: 'first-session' });
  try {
    await r.client.ping();
    r.fake.stop();
    const second = await startFakeBridge({ stateDir: r.dirs.stateDir, prefsDir: r.dirs.prefsDir, session: 'second-session' });
    try {
      await r.client.run('return 1', 1000);
      assert.equal(second.requests[0]?.session, 'second-session');
      assert.equal(hex('x'), '78');
    } finally {
      second.stop();
    }
  } finally {
    await r.close();
  }
});
