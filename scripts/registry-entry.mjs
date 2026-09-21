#!/usr/bin/env node
// Prints the MCP Registry entry (server.json) for one release on stdout, built from manifest.json
// and package.json plus the two things only a published release knows: its tag and the SHA-256 of
// the uploaded bundle. Nothing is committed: the registry job in .github/workflows/release.yml
// generates the entry from the asset the GitHub Release serves and publishes it with
// `mcp-publisher login github-oidc`; a manual publish runs the same command with the digest from
// `gh release view vX.Y.Z --json assets` and then `mcp-publisher login github` + `publish`.
//
// Usage: node scripts/registry-entry.mjs vX.Y.Z <sha256> [github-repo-id] > .out/server.json
// The repo id (`gh api repos/<owner>/<repo> --jq .id`, `${{ github.repository_id }}` in Actions) is
// the schema's optional repository.id, stable across renames; the entry is valid without it.
//
// The registry's rules for an mcpb package (docs/modelcontextprotocol-io/package-types.mdx in the
// registry repo): the identifier is a GitHub or GitLab Releases URL containing "mcp", fileSha256 is
// present (the registry does not check it, clients do before installing). The io.github.<owner>
// namespace is the one GitHub login and GitHub OIDC prove. The schema caps description at 100
// characters, shorter than the manifest's, hence the separate DESCRIPTION.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const BUNDLE = 'davinci-resolve-lua-mcp.mcpb'; // the Makefile's BUNDLE basename, the asset name on every release
const DESCRIPTION = 'Control the free edition of DaVinci Resolve 21.1 from Claude through a Lua script inside Resolve.';

const fail = (msg) => {
  process.stderr.write(`registry-entry: ${msg}\n`);
  process.exit(1);
};

const [tag, sha, repoId] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) fail('usage: registry-entry.mjs vX.Y.Z <sha256> [github-repo-id]');
if (!/^[0-9a-f]{64}$/.test(sha ?? '')) fail('the second argument must be the lowercase hex SHA-256 of the bundle');
if (repoId !== undefined && !/^\d+$/.test(repoId)) fail('the third argument, when given, is the numeric GitHub repository id');
if (DESCRIPTION.length > 100) fail('DESCRIPTION exceeds the schema\'s 100 characters');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = tag.slice(1);
if (manifest.version !== version || pkg.version !== version) {
  fail(`${tag} does not match manifest.json ${manifest.version} / package.json ${pkg.version}`);
}

const repoUrl = manifest.repository.url.replace(/\.git$/, '').replace(/\/$/, '');
const [owner] = new URL(repoUrl).pathname.replace(/^\//, '').split('/');
if (!owner) fail(`no owner in manifest.json repository.url ${manifest.repository.url}`);

const entry = {
  $schema: SCHEMA,
  name: `io.github.${owner}/${manifest.name}`,
  title: manifest.display_name,
  description: DESCRIPTION,
  version,
  websiteUrl: manifest.homepage,
  repository: { url: repoUrl, source: 'github', ...(repoId === undefined ? {} : { id: repoId }) },
  packages: [
    {
      registryType: 'mcpb',
      identifier: `${repoUrl}/releases/download/${tag}/${BUNDLE}`,
      fileSha256: sha,
      transport: { type: 'stdio' },
    },
  ],
};
process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
