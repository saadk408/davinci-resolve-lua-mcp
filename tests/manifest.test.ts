// manifest.json (MCPB v0.4) must advertise exactly the tools the server registers, the three
// version strings (package.json, manifest.json, the server) must agree, and privacy_policies must
// name at least one https URL (the extension directory rejects a local extension without one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.js';
import { DocsIndex } from '../src/docsSearch.js';
import { silentLogger } from '../src/log.js';
import type { Bridge } from '../src/protocol.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from '../src/server.js';
import { makeTempDirs, repoRoot } from './helpers/tmp.js';

interface Manifest {
  manifest_version: string;
  name: string;
  version: string;
  display_name: string;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env: Record<string, string>; platform_overrides?: unknown } };
  user_config: Record<string, { type: string; default?: unknown }>;
  compatibility: { platforms: string[]; runtimes: { node: string } };
  tools: Array<{ name: string; description: string }>;
  tools_generated: boolean;
  privacy_policies: string[];
}

test('manifest.json tools equal tools/list and the versions agree', async () => {
  const root = repoRoot();
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
  const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string };
  assert.equal(manifest.manifest_version, '0.4');
  assert.equal(manifest.name, SERVER_NAME);
  assert.equal(pkg.name, SERVER_NAME);
  assert.equal(manifest.version, SERVER_VERSION);
  assert.equal(pkg.version, SERVER_VERSION);
  assert.equal(manifest.display_name, 'DaVinci Resolve Lua MCP');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.js');
  assert.equal(manifest.server.mcp_config.command, 'node');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.js']);
  assert.deepEqual(manifest.server.mcp_config.env, {
    RLB_SCRIPTS_DIR: '${user_config.scripts_dir}',
    RLB_AUTO_INSTALL: '${user_config.auto_install_bridge}',
    RLB_STATE_DIR: '${user_config.state_dir}',
    RLB_DEFAULT_TIMEOUT_S: '${user_config.default_timeout_s}',
    RLB_PREFS_DIR: '${user_config.prefs_dir}',
  });
  assert.deepEqual(Object.keys(manifest.user_config).sort(), ['auto_install_bridge', 'default_timeout_s', 'prefs_dir', 'scripts_dir', 'state_dir']);
  // MCPB has no per-platform user_config defaults: the two Resolve folders have none (an empty picker
  // arrives as "", which the server treats as unset and replaces with the platform default); the
  // state dir default is valid on both platforms. One bundle serves both, so no platform_overrides.
  assert.equal(manifest.user_config['scripts_dir']?.default, undefined);
  assert.equal(manifest.user_config['prefs_dir']?.default, undefined);
  assert.equal(manifest.user_config['state_dir']?.default, '${HOME}/.davinci-resolve-lua-mcp');
  assert.deepEqual(manifest.compatibility.platforms, ['darwin', 'win32']);
  assert.equal(manifest.server.mcp_config.platform_overrides, undefined);
  assert.equal(manifest.compatibility.runtimes.node, '>=20.0.0');
  assert.equal(manifest.tools_generated, false);
  assert.ok(Array.isArray(manifest.privacy_policies) && manifest.privacy_policies.length > 0, 'privacy_policies lists at least one URL');
  for (const url of manifest.privacy_policies) assert.match(url, /^https:\/\//, 'privacy policy URLs are https');

  const dirs = await makeTempDirs();
  try {
    const config = loadConfig({ RLB_STATE_DIR: dirs.stateDir, RLB_PREFS_DIR: dirs.prefsDir, RLB_DOCS_DIR: dirs.docsDir, RLB_SCRIPTS_DIR: dirs.scriptsDir }, dirs.root);
    const bridge: Bridge = {
      request: async () => {
        throw new Error('unused');
      },
      status: async () => ({ alive: false, lock: { path: '', owned: true }, state_dir: dirs.stateDir }),
    };
    const server = createServer({
      config,
      bridge,
      docs: new DocsIndex(config.docsDir),
      install: async () => ({ outcome: 'up_to_date', message: '', scripts_dir: '', state_dir: '', files: [], checked_at: '' }),
      logger: silentLogger,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await server.connect(st);
    await client.connect(ct);
    const { tools } = await client.listTools();
    assert.deepEqual(
      manifest.tools.map((t) => t.name).sort(),
      tools.map((t) => t.name).sort(),
      'manifest tools[] must list exactly the registered tools',
    );
    for (const t of manifest.tools) {
      assert.ok(t.description.length > 20, `${t.name} has a manifest description`);
      assert.ok(t.name.length <= 64);
    }
    await client.close();
    await server.close();
  } finally {
    await dirs.cleanup();
  }
});
