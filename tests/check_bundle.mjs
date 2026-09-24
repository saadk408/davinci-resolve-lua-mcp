// Gate for the packed bundle, on macOS and Windows alike: the archive holds exactly the shipped
// files, stays under 2 MB, its server carries the jpeg-js licence notices and not the jpeg-js
// decoder, and the unpacked copy answers tools/list with the 16 tools and
// resolve_status with this platform over stdio (under temp dirs, with the self-install off, so
// nothing outside the temp dir is touched). The unpack goes through the pinned mcpb CLI's own
// `unpack` (never npx), so the gate needs no zipinfo, unzip, stat or mktemp.
// Run: node tests/check_bundle.mjs [dist/davinci-resolve-lua-mcp.mcpb]
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['manifest.json', 'package.json', 'server/index.js', 'bridge/resolve_mcp_bridge.lua', 'scripts/claude_diag.lua', 'icon.png'];
const OPTIONAL = ['README.md', 'LICENSE'];
const SIZE_LIMIT = 2 * 1024 * 1024;
const TOOL_COUNT = 16;
const PROBE_TIMEOUT_MS = 30_000;

const bundle = path.resolve(process.argv[2] ?? 'dist/davinci-resolve-lua-mcp.mcpb');
let fail = 0;
const bad = (msg) => {
  console.log(`check_bundle: FAIL: ${msg}`);
  fail = 1;
};

if (!fs.existsSync(bundle)) {
  bad(`${bundle} not found (npm run bundle)`);
  process.exit(1);
}

// 1. Size.
const size = fs.statSync(bundle).size;
if (size >= SIZE_LIMIT) bad(`bundle is ${size} bytes, the limit is 2 MB`);

/**
 * The pinned mcpb CLI's entry file, resolved from this repository's dependency (never npx). The
 * package's exports map hides its package.json, so resolve the main entry and walk up to the
 * package root, then read `bin` from there.
 */
function mcpbCli() {
  let entry;
  try {
    entry = createRequire(import.meta.url).resolve('@anthropic-ai/mcpb');
  } catch {
    entry = fileURLToPath(import.meta.resolve('@anthropic-ai/mcpb'));
  }
  let dir = path.dirname(entry);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === '@anthropic-ai/mcpb') {
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.mcpb;
        return path.join(dir, bin);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('cannot locate the @anthropic-ai/mcpb package');
    dir = parent;
  }
}

/** Every file under `root`, as forward-slash paths relative to it (mcpb writes no directory entries). */
function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

/** Spawn the unpacked server, send the JSON-RPC lines, close stdin and collect what comes back. */
function probe(serverJs, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverJs], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check_bundle', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'resolve_status', arguments: {} } },
    ];
    child.stdin.end(lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rlb-bundle-'));
let fileCount = 0;
try {
  // 2. Unpack with the pinned CLI and compare the file list with the allowlist.
  const unpacked = path.join(tmp, 'bundle');
  const u = spawnSync(process.execPath, [mcpbCli(), 'unpack', bundle, unpacked], { encoding: 'utf8', windowsHide: true });
  if (u.status !== 0) bad(`mcpb unpack exited ${u.status}: ${(u.stderr || u.stdout || '').trim()}`);
  const files = fs.existsSync(unpacked) ? listFiles(unpacked) : [];
  fileCount = files.length;
  for (const f of REQUIRED) if (!files.includes(f)) bad(`missing ${f}`);
  for (const f of files) if (!REQUIRED.includes(f) && !OPTIONAL.includes(f)) bad(`unexpected file in the bundle: ${f} (add it to .mcpbignore)`);

  // 2b. A private instrumented build lives in another repository (tests/check_server.sh gates the
  // sources the same way): its vendor name must not be inside anything that ships.
  for (const f of ['server/index.js', 'manifest.json', 'package.json']) {
    const p = path.join(unpacked, f);
    if (fs.existsSync(p) && /sentry/i.test(fs.readFileSync(p, 'utf8'))) bad(`the word sentry appears in the bundle's ${f} (the private build's code must not enter the public bundle)`);
  }

  // 2c. capture_frame's JPEG encoder (jpeg-js, BSD-3-Clause) is inlined into server/index.js, so its
  // two copyright notices ship with it (src/image.ts carries them as a /*! */ legal comment, the
  // only kind esbuild keeps); the decoder, which the server never uses, stays out.
  const serverIndex = path.join(unpacked, 'server', 'index.js');
  if (fs.existsSync(serverIndex)) {
    const js = fs.readFileSync(serverIndex, 'utf8');
    for (const line of ['Copyright (c) 2014, Eugene Ware', 'Copyright (c) 2008, Adobe Systems Incorporated']) {
      if (!js.includes(line)) bad(`server/index.js lacks the jpeg-js licence notice "${line}"`);
    }
    if (js.includes('maxResolutionInMP')) bad("server/index.js contains the jpeg-js decoder (import 'jpeg-js/lib/encoder.js', never the package index)");
  }

  // 3. Probe: initialize, initialized, tools/list, resolve_status over stdio. Empty temp dirs stand in
  // for the state, prefs and docs folders, so the answer is deterministic (prefs_missing) on every
  // platform and the real user folders are never read. `...process.env` matters on Windows
  // (SystemRoot, PATH, APPDATA).
  const dirs = { state: path.join(tmp, 'state'), prefs: path.join(tmp, 'Profiles'), docs: path.join(tmp, 'docs') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const serverJs = path.join(unpacked, 'server', 'index.js');
  if (fs.existsSync(serverJs)) {
    const env = { ...process.env, RLB_STATE_DIR: dirs.state, RLB_PREFS_DIR: dirs.prefs, RLB_DOCS_DIR: dirs.docs, RLB_AUTO_INSTALL: 'false', RLB_LOG_LEVEL: 'warn' };
    const r = await probe(serverJs, env);
    if (r.timedOut) bad(`the unpacked server did not exit within ${PROBE_TIMEOUT_MS / 1000} s of stdin closing`);
    else if (r.code !== 0) bad(`the unpacked server exited ${r.code} (see stderr below)`);
    const replies = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      });
    const list = replies.find((m) => m && m.id === 2);
    const tools = Array.isArray(list?.result?.tools) ? list.result.tools.map((t) => t.name).sort() : null;
    if (!tools) bad('no tools/list reply from the unpacked server');
    else {
      if (tools.length !== TOOL_COUNT) bad(`expected ${TOOL_COUNT} tools, got ${tools.length}: ${tools.join(' ')}`);
      if (!tools.includes('resolve_status')) bad('resolve_status missing from tools/list');
    }
    const status = replies.find((m) => m && m.id === 3);
    const platform = status?.result?.structuredContent?.platform;
    if (platform !== process.platform) bad(`resolve_status.platform is ${JSON.stringify(platform)}, expected ${process.platform}`);
    if (fs.existsSync(path.join(dirs.state, 'lock'))) bad('the unpacked server left its lock file behind');
    if (fail && r.stderr.trim()) for (const line of r.stderr.trim().split('\n')) console.log(`  stderr: ${line}`);
  }
} finally {
  // Windows can answer EBUSY for a moment after the child exits; Node retries these.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (fail === 0) console.log(`check_bundle: OK (${TOOL_COUNT} tools, ${size} bytes, ${fileCount} files)`);
process.exit(fail);
