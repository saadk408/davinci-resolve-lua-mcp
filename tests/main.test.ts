// main(): the wiring behind index.ts, driven in-process through its runtime seams (a fake process,
// the server half of an in-memory transport, temp directories): the no-hook path, the wrapServer,
// onToolFailure and beforeExit extension points, the beforeExit cap, and the per-request lock on
// every exit path (never held while idle; released when a crash interrupts a request). Nothing here touches the real process handlers, stdio or ~/Library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { main, type MainHandle, type MainOptions } from '../src/main.js';
import type { BridgeRequestReport } from '../src/protocol.js';
import { startFakeBridge } from './helpers/fakeBridge.js';
import { exists, makeTempDirs, waitFor, type TempDirs } from './helpers/tmp.js';

class FakeProc extends EventEmitter {
  pid = process.pid;
  exits: number[] = [];
  stdin = new EventEmitter();
  exit(code: number): void {
    this.exits.push(code);
  }
}

interface Rig {
  dirs: TempDirs;
  proc: FakeProc;
  client: Client;
  handle: MainHandle;
  lockPath: string;
  close(): Promise<void>;
}

async function rig(options: Omit<MainOptions, 'runtime'> = {}, beforeExitCapMs = 2000): Promise<Rig> {
  const dirs = await makeTempDirs();
  const proc = new FakeProc();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const env = {
    RLB_STATE_DIR: dirs.stateDir,
    RLB_PREFS_DIR: dirs.prefsDir,
    RLB_DOCS_DIR: dirs.docsDir,
    RLB_SCRIPTS_DIR: dirs.scriptsDir,
    RLB_AUTO_INSTALL: 'false',
    RLB_LOG_LEVEL: 'error',
  };
  const handle = await main({ ...options, runtime: { env, proc, transport: st, beforeExitCapMs } });
  const client = new Client({ name: 'main-test', version: '0' });
  await client.connect(ct);
  return {
    dirs,
    proc,
    client,
    handle,
    lockPath: path.join(dirs.stateDir, 'lock'),
    close: async () => {
      await client.close().catch(() => undefined);
      await dirs.cleanup();
    },
  };
}

/** A request the (silent) fake bridge never answers, so the lock stays held while it is pending. */
async function holdSlot(r: Rig): Promise<{ pending: Promise<unknown>; stop: () => void }> {
  const fake = await startFakeBridge({ stateDir: r.dirs.stateDir, prefsDir: r.dirs.prefsDir, mode: 'silent' });
  const pending = r.client.callTool({ name: 'run_lua', arguments: { code: 'return 1', timeout_s: 1 } });
  await waitFor(() => exists(r.lockPath));
  return { pending, stop: () => fake.stop() };
}

test('main() without options serves the 15 tools, never holds the lock while idle and exits 0 on SIGTERM', async () => {
  const r = await rig();
  try {
    const { tools } = await r.client.listTools();
    assert.equal(tools.length, 15);
    assert.equal(await exists(r.lockPath), false, 'no lock while idle');
    const status = await r.client.callTool({ name: 'resolve_status', arguments: {} });
    assert.notEqual(status.isError, true);
    assert.equal(await exists(r.lockPath), false, 'released after the status ping');
    r.proc.emit('SIGTERM');
    await r.handle.shutdown('test', 0);
    assert.deepEqual(r.proc.exits, [0]);
    assert.equal(await exists(r.lockPath), false, 'the lock is released after the transport closed');
  } finally {
    await r.close();
  }
});

test('SIGBREAK (Windows Ctrl+Break) exits 0 like SIGTERM and releases the lock', async () => {
  const r = await rig();
  try {
    r.proc.emit('SIGBREAK');
    await r.handle.shutdown('test', 0);
    assert.deepEqual(r.proc.exits, [0]);
    assert.equal(await exists(r.lockPath), false);
  } finally {
    await r.close();
  }
});

test('wrapServer sees the McpServer exactly once, and beforeExit is awaited before exit(0)', async () => {
  const events: string[] = [];
  let wrapCalls = 0;
  const r = await rig({
    wrapServer: (server) => {
      wrapCalls += 1;
      assert.ok(server instanceof McpServer);
      server.registerTool('hook_probe', { description: 'added by wrapServer', inputSchema: z.object({}) }, async () => ({
        content: [{ type: 'text', text: 'probe' }],
      }));
      return server;
    },
    beforeExit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push('beforeExit');
    },
  });
  try {
    const { tools } = await r.client.listTools();
    assert.equal(wrapCalls, 1);
    assert.equal(tools.length, 16);
    const probe = await r.client.callTool({ name: 'hook_probe', arguments: {} });
    assert.equal((probe.content as Array<{ text?: string }>)[0]?.text, 'probe');
    const exit = r.proc.exit.bind(r.proc);
    r.proc.exit = (code: number) => {
      events.push(`exit(${code})`);
      exit(code);
    };
    r.proc.emit('SIGTERM');
    await r.handle.shutdown('test', 0);
    assert.deepEqual(events, ['beforeExit', 'exit(0)']);
    assert.equal(await exists(r.lockPath), false);
  } finally {
    await r.close();
  }
});

test('a crash runs beforeExit, exits 1 and releases the lock', async () => {
  const events: string[] = [];
  const r = await rig({
    beforeExit: async () => {
      events.push('beforeExit');
    },
  });
  try {
    const slot = await holdSlot(r);
    r.proc.emit('uncaughtException', new Error('boom'));
    await waitFor(() => r.proc.exits.length > 0);
    assert.deepEqual(r.proc.exits, [1]);
    assert.deepEqual(events, ['beforeExit']);
    assert.equal(await exists(r.lockPath), false, 'the lock of the in-flight request is released on the crash path');
    await slot.pending;
    slot.stop();
  } finally {
    await r.close();
  }
});

test('a beforeExit that never settles is cut off at the cap, and one that throws is ignored', async () => {
  const hung = await rig({ beforeExit: () => new Promise<void>(() => undefined) }, 50);
  try {
    const t0 = Date.now();
    hung.proc.emit('SIGTERM');
    await hung.handle.shutdown('test', 0);
    const elapsed = Date.now() - t0;
    assert.deepEqual(hung.proc.exits, [0]);
    assert.ok(elapsed >= 40 && elapsed < 1500, `the cap fired (${elapsed} ms)`);
  } finally {
    await hung.close();
  }
  const throwing = await rig({
    beforeExit: () => {
      throw new Error('sync throw');
    },
  });
  try {
    throwing.proc.emit('SIGINT');
    await throwing.handle.shutdown('test', 0);
    assert.deepEqual(throwing.proc.exits, [0]);
  } finally {
    await throwing.close();
  }
});

test('onToolFailure passed to main() reaches the tools; shutdown is idempotent', async () => {
  const seen: Array<[string, string]> = [];
  const r = await rig({
    onToolFailure: (err, tool) => {
      seen.push([err.kind, tool]);
    },
  });
  try {
    const res = await r.client.callTool({ name: 'run_lua', arguments: { code: 'return 1' } });
    assert.equal(res.isError, true, 'no bridge is running');
    const kind = (res.structuredContent as Record<string, unknown>)['kind'];
    assert.equal(typeof kind, 'string');
    assert.deepEqual(seen, [[kind as string, 'run_lua']]);
    const status = await r.client.callTool({ name: 'resolve_status', arguments: {} });
    assert.notEqual(status.isError, true);
    assert.equal(seen.length, 1, 'resolve_status never reports');
    const first = r.handle.shutdown('one', 0);
    const second = r.handle.shutdown('two', 3);
    assert.equal(first, second, 'later calls return the first shutdown');
    await first;
    assert.deepEqual(r.proc.exits, [0]);
  } finally {
    await r.close();
  }
});

test('onBridgeRequest passed to main() gets one report per bridge request, matching the tool result', async () => {
  const reports: BridgeRequestReport[] = [];
  const errors: unknown[] = [];
  const r = await rig({ onBridgeRequest: (report) => reports.push(report), onToolError: (err) => errors.push(err) });
  try {
    const res = await r.client.callTool({ name: 'run_lua', arguments: { code: 'return 1' } });
    assert.equal(res.isError, true, 'no bridge is running');
    const kind = (res.structuredContent as Record<string, unknown>)['kind'];
    const runs = reports.filter((rep) => rep.op === 'run');
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.outcome, kind, 'the report names the same failure the tool returned');
    assert.deepEqual(errors, [], 'a bridge failure is not a tool defect');
  } finally {
    await r.close();
  }
});

test("the process 'exit' backstop releases the lock", async () => {
  const r = await rig();
  try {
    const slot = await holdSlot(r);
    r.proc.emit('exit');
    assert.equal(await exists(r.lockPath), false);
    await slot.pending;
    slot.stop();
  } finally {
    await r.close();
  }
});
