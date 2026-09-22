import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { BRIDGE_FILES, installBridgeFiles, STAMP_TOKEN, stampLua, versionHeader } from '../src/bridgeInstall.js';
import { exists, makeTempDirs, repoRoot } from './helpers/tmp.js';

const STATE = '/Users/tester/.davinci-resolve-lua-mcp';

test('the bundled Lua files carry the placeholder in exactly two places and the expected headers', async () => {
  for (const f of BRIDGE_FILES) {
    const text = await fsp.readFile(path.join(repoRoot(), f.source), 'utf8');
    assert.equal(text.split(STAMP_TOKEN).length - 1, 2, `${f.source} has two placeholders`);
    assert.equal(text.split('\n')[1], `-- RLB_STATE_DIR=${STAMP_TOKEN}`);
    assert.match(versionHeader(text), /^-- (resolve_mcp_bridge|claude_diag) v\d+\.\d+\.\d+/);
    assert.ok(!text.includes('\r'), `${f.source} is LF-only (.gitattributes)`);
  }
});

test('stampLua replaces both sites, keeps the header prefix and refuses unsafe paths', async () => {
  const bridge = await fsp.readFile(path.join(repoRoot(), 'bridge/resolve_mcp_bridge.lua'), 'utf8');
  const stamped = stampLua(bridge, STATE);
  assert.ok(!stamped.includes(STAMP_TOKEN));
  assert.equal(stamped.split('\n')[1], `-- RLB_STATE_DIR=${STATE}`);
  assert.ok(stamped.includes(`local STATE_DIR_STAMP = [==[${STATE}]==]`));
  assert.throws(() => stampLua(bridge, '/x/]==]'), /]==]/);
  assert.throws(() => stampLua(bridge, '/x/"'), /quote/);
  assert.throws(() => stampLua(bridge, '/x/\n'), /line break/);
  assert.throws(() => stampLua('no placeholder', STATE), /placeholder/);
});

test('a Windows state dir is stamped in its forward-slash spelling; the backslash spelling is refused', async () => {
  const win = 'C:/Users/Tester/.davinci-resolve-lua-mcp';
  const bridge = await fsp.readFile(path.join(repoRoot(), 'bridge/resolve_mcp_bridge.lua'), 'utf8');
  const stamped = stampLua(bridge, win);
  assert.equal(stamped.split('\n')[1], `-- RLB_STATE_DIR=${win}`);
  assert.ok(stamped.includes(`local STATE_DIR_STAMP = [==[${win}]==]`));
  assert.throws(() => stampLua(bridge, 'C:\\Users\\Tester\\.davinci-resolve-lua-mcp'), /backslash/);
  // The state dir is only stamped, never opened, so this runs on any platform.
  const dirs = await makeTempDirs();
  try {
    const first = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: win, autoInstall: true, bundleDir: repoRoot() });
    assert.equal(first.outcome, 'installed', first.message);
    const text = await fsp.readFile(path.join(dirs.scriptsDir, 'resolve_mcp_bridge.lua'), 'utf8');
    assert.ok(text.includes(`[==[${win}]==]`));
    const again = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: win, autoInstall: true, bundleDir: repoRoot() });
    assert.equal(again.outcome, 'up_to_date', again.message);
  } finally {
    await dirs.cleanup();
  }
});

test('install, update, up_to_date and re-stamp in a temp Utility folder', async () => {
  const dirs = await makeTempDirs();
  try {
    const base = { scriptsDir: dirs.scriptsDir, stateDir: dirs.stateDir, autoInstall: true, bundleDir: repoRoot() };
    const first = await installBridgeFiles(base);
    assert.equal(first.outcome, 'installed', first.message);
    assert.deepEqual(first.files.map((f) => f.action), ['installed', 'installed']);
    const target = path.join(dirs.scriptsDir, 'resolve_mcp_bridge.lua');
    const text = await fsp.readFile(target, 'utf8');
    assert.equal(text.split('\n')[1], `-- RLB_STATE_DIR=${dirs.stateDir}`);
    assert.ok(text.includes(`[==[${dirs.stateDir}]==]`));
    assert.equal(await exists(`${target}.tmp`), false);

    const second = await installBridgeFiles(base);
    assert.equal(second.outcome, 'up_to_date');

    await fsp.writeFile(target, text.replace(/^-- resolve_mcp_bridge v[\d.]+/, '-- resolve_mcp_bridge v0.0.1'));
    const third = await installBridgeFiles(base);
    assert.equal(third.outcome, 'updated');
    assert.match(third.files[0]?.reason ?? '', /version header/);
    assert.equal(await fsp.readFile(target, 'utf8'), text);

    const moved = await installBridgeFiles({ ...base, stateDir: path.join(dirs.root, 'elsewhere') });
    assert.equal(moved.outcome, 'updated');
    assert.match(moved.files[0]?.reason ?? '', /stamp/);
    assert.ok((await fsp.readFile(target, 'utf8')).includes(path.join(dirs.root, 'elsewhere')));
  } finally {
    await dirs.cleanup();
  }
});

test('missing folder, permission denied, auto-install off and an unstampable state dir are reported, never fixed', async () => {
  const dirs = await makeTempDirs();
  try {
    const missing = path.join(dirs.root, 'no-such', 'Utility');
    const r1 = await installBridgeFiles({ scriptsDir: missing, stateDir: dirs.stateDir, autoInstall: true, bundleDir: repoRoot() });
    assert.equal(r1.outcome, 'scripts_dir_missing');
    assert.equal(await exists(missing), false, 'never creates Resolve folders');
    assert.match(r1.message, /never creates/);

    const r2 = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: dirs.stateDir, autoInstall: false, bundleDir: repoRoot() });
    assert.equal(r2.outcome, 'skipped_auto_install_off');
    assert.equal(await exists(path.join(dirs.scriptsDir, 'resolve_mcp_bridge.lua')), false);

    const r3 = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: '/x/]==]', autoInstall: true, bundleDir: repoRoot() });
    assert.equal(r3.outcome, 'state_dir_unstampable');

    const r4 = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: dirs.stateDir, autoInstall: true, bundleDir: path.join(dirs.root, 'nowhere') });
    assert.equal(r4.outcome, 'error');
    assert.match(r4.message, /bundled/);

    if (process.getuid && process.getuid() !== 0) {
      await fsp.chmod(dirs.scriptsDir, 0o500);
      try {
        const r5 = await installBridgeFiles({ scriptsDir: dirs.scriptsDir, stateDir: dirs.stateDir, autoInstall: true, bundleDir: repoRoot() });
        assert.equal(r5.outcome, 'permission_denied', r5.message);
      } finally {
        await fsp.chmod(dirs.scriptsDir, 0o700);
      }
    }
  } finally {
    await dirs.cleanup();
  }
});
