// stdout is the MCP transport: nothing the server does during a tool call may write to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.js';
import { DocsIndex } from '../src/docsSearch.js';
import { createLogger } from '../src/log.js';
import { BridgeClient } from '../src/protocol.js';
import { createServer, TOOL_NAMES } from '../src/server.js';
import { startFakeBridge } from './helpers/fakeBridge.js';
import { makeTempDirs } from './helpers/tmp.js';

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  run_lua: { code: 'return 1' },
  list_media_pool_clips: {},
  get_timeline_items: { track_type: 'video', track_index: 1 },
  add_marker: { frame: 0, color: 'Blue', name: 'x' },
  delete_markers: { confirm: true },
  set_current_timeline: { name: 'TL' },
  open_project: { name: 'Demo' },
  render_current_timeline: { output_dir: '/tmp', filename: 'x' },
  get_render_status: { job_id: 'j' },
  scripting_api_docs: { query: 'AddMarker' },
};

test('every tool call leaves stdout untouched, with and without a bridge, and logs go to the file', async () => {
  const dirs = await makeTempDirs();
  const fake = await startFakeBridge({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, responder: () => ({ ok: true, result: { ok: true, stopped: true, session: 's' }, prints: [] }) });
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const logFile = path.join(dirs.stateDir, 'server.log');
  try {
    const config = loadConfig({ RLB_STATE_DIR: dirs.stateDir, RLB_PREFS_DIR: dirs.prefsDir, RLB_DOCS_DIR: dirs.docsDir, RLB_SCRIPTS_DIR: dirs.scriptsDir }, dirs.root);
    const logger = createLogger({ file: logFile, level: 'debug', stderr: false });
    const bridge = new BridgeClient({ stateDir: dirs.stateDir, prefsDir: dirs.prefsDir, maxResponseKb: 64, pollMs: 5, logger });
    const server = createServer({
      config,
      bridge,
      docs: new DocsIndex(config.docsDir),
      install: async () => ({ outcome: 'up_to_date', message: 'ok', scripts_dir: dirs.scriptsDir, state_dir: dirs.stateDir, files: [], checked_at: 'now' }),
      logger,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await server.connect(st);
    await client.connect(ct);
    for (const name of TOOL_NAMES) {
      if (name === 'stop_bridge') continue; // last, so the others still see a running bridge
      await client.callTool({ name, arguments: SAMPLE_ARGS[name] ?? {} });
    }
    await client.callTool({ name: 'stop_bridge', arguments: {} });
    await client.callTool({ name: 'resolve_status', arguments: {} });
    await client.close();
    await server.close();
    bridge.releaseLockSync();
    assert.deepEqual(writes, [], 'stdout must stay empty');
    const log = await fsp.readFile(logFile, 'utf8');
    assert.match(log, /DEBUG request written/);
    assert.match(log, /response received/);
  } finally {
    process.stdout.write = original;
    fake.stop();
    await dirs.cleanup();
  }
});
