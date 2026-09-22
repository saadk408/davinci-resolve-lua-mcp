#!/usr/bin/env node
// set-version.mjs: write one version into the three places that must agree (package.json,
// manifest.json and SERVER_VERSION in src/server.ts); tests/manifest.test.ts checks the agreement
// and release.yml refuses a tag that differs. Textual edits of the one version line each, not a
// JSON re-serialisation: manifest.json is hand-formatted (inline objects) and a re-stringify would
// rewrite every line. The Lua headers, BRIDGE_TAG and the prefs envelope stay manual and change
// only when the Lua changed (CLAUDE.md, Releasing). Developer-only (.mcpbignore), plain Node 20,
// no dependencies.
//
//   node scripts/set-version.mjs X.Y.Z        (a pre-release suffix is allowed; build metadata is not:
//                                              the tag is v<version>)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

function die(message) {
  console.error(`set-version: ${message}`);
  process.exit(1);
}

if (!version || !SEMVER.test(version)) die('usage: node scripts/set-version.mjs X.Y.Z');

// One line per file, anchored at the top level (two-space indent) so a nested "version" key can
// never match; the replacement keeps everything around the value byte for byte.
const SITES = [
  { file: 'package.json', pattern: /^(  "version": ")([^"]+)(",)$/gm, json: true },
  { file: 'manifest.json', pattern: /^(  "version": ")([^"]+)(",)$/gm, json: true },
  { file: 'src/server.ts', pattern: /^(export const SERVER_VERSION = ')([^']+)(';)$/gm, json: false },
];

for (const { file, pattern, json } of SITES) {
  const p = join(root, file);
  const text = readFileSync(p, 'utf8');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) die(`${file}: expected exactly one version line, found ${matches.length}`);
  const before = matches[0][2];
  const next = text.replace(pattern, `$1${version}$3`);
  if (json) {
    const parsed = JSON.parse(next);
    if (parsed.version !== version) die(`${file}: the rewritten file does not carry ${version}`);
  }
  if (next !== text) writeFileSync(p, next);
  console.error(`set-version: ${file}: ${before} -> ${version}${next === text ? ' (unchanged)' : ''}`);
}
