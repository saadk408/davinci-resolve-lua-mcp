#!/usr/bin/env node
// dev-register.mjs: the developer loop (docs/plan.md Step 4). Merges one entry into Claude
// Desktop's claude_desktop_config.json that runs this checkout's server/index.js with the current
// Node binary, so a code change needs `make build` and a Claude Desktop restart instead of a
// repack. Backs the file up first, keeps every other key, keeps mode 0600 and never overwrites a
// file it cannot parse. Plain Node 20, no dependencies.
//
//   node scripts/dev-register.mjs              add or update the entry
//   node scripts/dev-register.mjs --remove     delete the entry
//   --config <path>   the config file (default ~/Library/Application Support/Claude/claude_desktop_config.json)
//   --name <key>      the mcpServers key (default davinci-resolve-lua)
//   --env <path>      KEY=VALUE file whose RLB_* lines become the entry's env (default <repo>/.env)
//   --dry-run         print the resulting config and write nothing
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const configPath = resolve(opt('--config', join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')));
const name = opt('--name', 'davinci-resolve-lua');
const envPath = resolve(opt('--env', join(root, '.env')));
const remove = args.includes('--remove');
const dryRun = args.includes('--dry-run');
const serverJs = join(root, 'server', 'index.js');

function die(message) {
  console.error(`dev-register: ${message}`);
  process.exit(1);
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Minimal KEY=VALUE reader: blank and # lines skipped, surrounding quotes stripped, RLB_* keys only. */
function readEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (m[1].startsWith('RLB_')) out[m[1]] = value;
  }
  return out;
}

let config = {};
const existed = existsSync(configPath);
if (existed) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); // tolerate a BOM
  } catch (err) {
    die(`${configPath} is not valid JSON (${err instanceof Error ? err.message : String(err)}); not touching it`);
  }
  if (!isPlainObject(parsed)) die(`${configPath} does not hold a JSON object; not touching it`);
  config = parsed;
} else {
  console.error(`dev-register: ${configPath} does not exist; it will be created`);
}
if (config.mcpServers === undefined) config.mcpServers = {};
if (!isPlainObject(config.mcpServers)) die(`${configPath}: "mcpServers" is not an object; not touching it`);

if (remove) {
  if (!Object.prototype.hasOwnProperty.call(config.mcpServers, name)) {
    console.error(`dev-register: no "${name}" entry in ${configPath}; nothing to do`);
    process.exit(0);
  }
  delete config.mcpServers[name];
} else {
  const env = readEnvFile(envPath);
  const entry = { command: process.execPath, args: [serverJs] };
  if (Object.keys(env).length > 0) entry.env = env;
  config.mcpServers[name] = entry;
  if (!existsSync(serverJs)) console.error(`dev-register: note: ${serverJs} does not exist yet; run make build`);
}

const json = `${JSON.stringify(config, null, 2)}\n`;
if (dryRun) {
  process.stdout.write(json);
  console.error('dev-register: dry run, nothing written');
  process.exit(0);
}
if (existed) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const backup = `${configPath}.bak-${stamp}`;
  copyFileSync(configPath, backup);
  console.error(`dev-register: backup at ${backup}`);
}
mkdirSync(dirname(configPath), { recursive: true });
const tmp = `${configPath}.tmp-${process.pid}`;
writeFileSync(tmp, json, { mode: 0o600 });
renameSync(tmp, configPath);
console.error(
  remove
    ? `dev-register: removed "${name}" from ${configPath}`
    : `dev-register: "${name}" now runs ${process.execPath} ${serverJs} (${configPath})`,
);
console.error('dev-register: restart Claude Desktop for the change to take effect');
