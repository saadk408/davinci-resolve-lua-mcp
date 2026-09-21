// scripts/dev-register.mjs against a temp config file only: the tests never touch the real
// claude_desktop_config.json. Spawning the script is fine here (the no-spawn rule covers src/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { makeTempDirs, repoRoot } from './helpers/tmp.js';

const SCRIPT = path.join(repoRoot(), 'scripts', 'dev-register.mjs');
const SERVER_JS = path.join(repoRoot(), 'server', 'index.js');

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function readJson(p: string): Promise<Record<string, any>> {
  return JSON.parse(await fsp.readFile(p, 'utf8')) as Record<string, any>;
}

test('dev-register merges the entry, keeps everything else, backs up, keeps 0600; --remove deletes only the entry', async () => {
  const dirs = await makeTempDirs();
  const cfg = path.join(dirs.root, 'claude_desktop_config.json');
  const envFile = path.join(dirs.root, 'dev.env');
  try {
    const before = { coworkUserFilesPath: '/x', mcpServers: { other: { command: 'npx', args: ['-y', 'thing'] } }, preferences: { a: 1 } };
    await fsp.writeFile(cfg, JSON.stringify(before, null, 2), { mode: 0o600 });
    await fsp.writeFile(envFile, '# comment\nRLB_LOG_LEVEL="debug"\nexport RLB_STATE_DIR=/tmp/rlb\nOTHER=ignored\n');

    const r1 = run('--config', cfg, '--env', envFile);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r1.stdout, '', 'nothing on stdout outside --dry-run');
    assert.match(r1.stderr, /restart Claude Desktop/);
    const after = await readJson(cfg);
    assert.equal(after['coworkUserFilesPath'], '/x');
    assert.deepEqual(after['preferences'], { a: 1 });
    assert.deepEqual(after['mcpServers'].other, { command: 'npx', args: ['-y', 'thing'] });
    assert.deepEqual(after['mcpServers']['davinci-resolve-lua-mcp-dev'], {
      command: process.execPath,
      args: [SERVER_JS],
      env: { RLB_LOG_LEVEL: 'debug', RLB_STATE_DIR: '/tmp/rlb' },
    });
    assert.equal((await fsp.stat(cfg)).mode & 0o777, 0o600);
    const backups = (await fsp.readdir(dirs.root)).filter((f) => f.startsWith('claude_desktop_config.json.bak-'));
    assert.equal(backups.length, 1, 'one backup');
    assert.deepEqual(await readJson(path.join(dirs.root, backups[0] as string)), before, 'the backup is the original');

    const r2 = run('--config', cfg, '--remove');
    assert.equal(r2.status, 0, r2.stderr);
    const removed = await readJson(cfg);
    assert.equal(removed['mcpServers']['davinci-resolve-lua-mcp-dev'], undefined);
    assert.deepEqual(removed['mcpServers'].other, { command: 'npx', args: ['-y', 'thing'] });
    assert.deepEqual(removed['preferences'], { a: 1 });

    const r3 = run('--config', cfg, '--remove');
    assert.equal(r3.status, 0);
    assert.match(r3.stderr, /nothing to do/);
  } finally {
    await dirs.cleanup();
  }
});

test('dev-register creates a missing config, honours --name and --dry-run, and refuses unparsable JSON', async () => {
  const dirs = await makeTempDirs();
  const cfg = path.join(dirs.root, 'fresh.json');
  try {
    const dry = run('--config', cfg, '--name', 'rlb-dev', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(await fsp.access(cfg).then(() => true, () => false), false, 'dry run writes nothing');
    const preview = JSON.parse(dry.stdout) as Record<string, any>;
    assert.deepEqual(Object.keys(preview['mcpServers']), ['rlb-dev']);
    assert.equal(preview['mcpServers']['rlb-dev'].env, undefined, 'no env without an env file');

    const real = run('--config', cfg, '--name', 'rlb-dev');
    assert.equal(real.status, 0, real.stderr);
    const written = await readJson(cfg);
    assert.deepEqual(written['mcpServers']['rlb-dev'].args, [SERVER_JS]);
    assert.equal((await fsp.stat(cfg)).mode & 0o777, 0o600);
    const backups = (await fsp.readdir(dirs.root)).filter((f) => f.includes('.bak-'));
    assert.equal(backups.length, 0, 'no backup of a file that did not exist');

    await fsp.writeFile(cfg, '{ not json');
    const bad = run('--config', cfg);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not valid JSON/);
    assert.equal(await fsp.readFile(cfg, 'utf8'), '{ not json', 'an unparsable file is left alone');
  } finally {
    await dirs.cleanup();
  }
});
