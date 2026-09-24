# Contributing

This file is the branch, review and release flow. The [README](README.md) covers install and
use; `CLAUDE.md` is the design record.

## Branches and pull requests

- `main` is what users get: every commit on it is releasable, and a `vX.Y.Z` tag on it is a
  release. Nothing is pushed to `main` directly; a ruleset refuses it, with no bypass.
- Work on a short-lived branch (`feat/...`, `fix/...`, `docs/...`, `chore/...`), one change per
  branch, and open a pull request. The three checks (`node 20` and `node 24` on macOS,
  `windows node 20`) must pass; the PR is squash-merged and the branch deleted. The PR title and
  body become the commit message on `main`, so write the body as one: what changed and why.
- From a fork: the checks run with a read-only token, so they work from any fork. A first-time
  contributor's run waits for the maintainer's approval before it starts.
- Before pushing: `make test` (the Lua checks need `fuscript` from a DaVinci Resolve install; the
  Node suite runs anywhere), `make lint-lua`, `make bundle` (the packed extension must hold exactly
  the eight shipped files). A change to `bridge/resolve_mcp_bridge.lua` or `scripts/claude_diag.lua`
  should also go through `make smoke SMOKE_PROJECT="<scratch project>"` against a live Resolve.

## Developer loop

`make dev-register` once adds a `davinci-resolve-lua-mcp-dev` entry to Claude Desktop that runs
`server/index.js` from this checkout (`--server <path>` points it at another checkout's build, for
example a git worktree). Then `make build` and restart Claude Desktop after each change.

The dev entry and an installed copy of the extension answer to the same sixteen tool names, so
disable one of them in Claude Desktop while testing the other. When your branch changes the Lua,
whichever server starts last overwrites the copy in Resolve's Utility folder and the other reports
`updated` on its next start: keep the installed extension disabled until the branch is merged, or
relaunch `Workspace > Scripts > resolve_mcp_bridge` after every Claude Desktop restart.

## Releases (maintainer)

1. On a branch: `node scripts/set-version.mjs X.Y.Z` writes the version into `package.json`,
   `manifest.json` and `src/server.ts`; when the Lua changed, bump the headers of the two Lua files
   and the tags the tests expect (`CLAUDE.md`, Releasing). `make lint-lua`, `make test`,
   `make bundle`, commit, open the release PR.
2. Staging: remove the installed extension in Claude Desktop, `make install` the candidate,
   relaunch the bridge script in Resolve, `make smoke` on a scratch project, one `resolve_status`
   in a chat.
3. Squash-merge, then tag the PR's merge commit, not whatever `main` moved to since:
   ```sh
   sha=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)
   git tag -a vX.Y.Z "$sha"
   git push origin vX.Y.Z
   ```
   Only the maintainer can create `v*` tags.
4. The release workflow re-runs the gates on the tag, packs the bundle, attests its build
   provenance, publishes an immutable GitHub Release with the bundle and its SHA-256, then
   publishes the release to the MCP Registry. A published tag is never re-run: fix forward with a
   new tag.
5. Verify the served file, not the local pack (each pack has different bytes):
   ```sh
   gh release download vX.Y.Z --pattern '*.mcpb' --dir /tmp/rel
   gh attestation verify /tmp/rel/davinci-resolve-lua-mcp.mcpb -R saadk408/davinci-resolve-lua-mcp
   ```

Rolling back is installing the previous release's `.mcpb` from its release page; immutable
releases keep every asset. A hotfix for an older version, should one ever be needed, is fixed on
`main` first, then cherry-picked onto a `release/X.Y.x` branch cut from the old tag (together with
the commit that pinned the workflow actions, which the repository requires), tagged from there,
and the branch deleted afterwards.

## Verifying a download

Anyone can check that a bundle is the one the release workflow built:

```sh
gh attestation verify davinci-resolve-lua-mcp.mcpb -R saadk408/davinci-resolve-lua-mcp
```
