# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`resolve-lua-bridge` is an MCP server, shipped as an **MCPB bundle** for Claude Desktop, that controls **DaVinci Resolve 21.1 free edition on macOS**. Blackmagic removed Python and external scripting from the free edition in 21.1 and their native MCP server is Studio only. The one remaining door is a Lua script launched from `Workspace > Scripts` inside Resolve, which receives the live `resolve` object. That script runs as a long-lived in-app bridge and executes Lua on behalf of the server. Requests arrive as a file the bridge reads with `loadfile`; responses go back through `fusion:SetPrefs` + `fusion:SavePrefs()`, which the server reads from `Fusion.prefs` on disk. The server is **TypeScript on the v2 TypeScript SDK (`@modelcontextprotocol/server`)**, bundled by esbuild into one file and launched by the Node that ships inside Claude Desktop.

## Current state (as of 2026-09-20)

- **Step 0 is done.** `docs/plan.md` is the **single source of truth**: mission, measured ground truth, safety rules, protocol v1, repository layout, Steps 1-7 and the definition of done. `docs/plan-review-2026-09.md` is the validation record (sections A-L explain every departure from the original spec, including the user-approved architecture changes: response channel via prefs, MCPB distribution, Node/TypeScript runtime) and `docs/research-2026-09.md` holds the evidence. The original mission spec was retired on 2026-09-20 and exists only in git history (commit `73eb388`); do not look for it.
- **Step 1 is done (2026-09-20): verdict CONTINUE.** `docs/diagnostic-2026-09.md` is the verbatim
  record (two runs, both decoded results, the prefs observer log, the user's report) and its
  "Consequences for the plan" section lists what was folded into `docs/plan.md` and this file.
  The only code so far is `scripts/claude_diag.lua`; its `hex`/`json`/`dump_list`/`save_prefs`
  helpers are the Step 2 encoder prototype. Next is Step 2 (the bridge), then Steps 3-7 in order.
- Git repository on `main`; `.gitignore` covers `.DS_Store`, `.remember/`, `.venv/`, `node_modules/`, `dist/`, `server/`.

## Hard gates, in order

1. **Step 0: research and re-plan.** Done. Required Context7 (`resolve-library-id` + `query-docs`) and Exa; both are available in this environment.
2. **Step 1: viability diagnostic.** Done 2026-09-20, verdict **CONTINUE**: the script observably ran (bins and prefs), `loadfile` of `~/.resolve-lua-bridge/next.lua` returned its table and the code executed with captured `print`, every `SetPrefs`+`SavePrefs` landed in `Fusion.prefs` within the same second (1 to 6 ms per save), and the UI stayed responsive through two 30 s loops. `io` is nil as expected. Record: `docs/diagnostic-2026-09.md`.
3. Only then write the bridge, server, bundle, tests, and README, in the order of `docs/plan.md`.

Architecture-level changes (the request file, the prefs response channel, the trust boundary, what runs inside Resolve, the runtime, the distribution format) must be presented to the user as a tradeoff before proceeding. Implementation-level improvements can be adopted directly, with a note in the relevant doc.

## Machine ground truth (verified on this Mac)

The Console measurements of 2026-09-19 in `docs/plan.md` ("Ground truth: measured facts about this machine") are authoritative. Verified 2026-09-20:

- Resolve 21.1.0 build 21.1.00017, free edition. Blackmagic's scripting docs ship at `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/`: `README.md` (31 Aug 2026), `CHANGELOG.md`, `DaVinciResolveScript.pyi`, `Examples/`, `Modules/`. **The README no longer contains API tables; `DaVinciResolveScript.pyi` is the signature reference** (typed, with docstrings, 16 marker colours). Use the `.pyi` for the `scripting_api_docs` tool and when writing tools. Deprecated forms to avoid: `GetSetting/SetSetting` (use `GetSettings()/SetSettings({})`), `GetItemsInTrack` (use `GetItemListInTrack`), index-based render job calls (ids are strings), single-arg `GetClipProperty`.
- The free 21.1 Scripts-menu Lua state is sandboxed (measured on this Mac in Step 1, plus four community measurements): `io`, `os.execute`, `os.remove`, `os.rename`, `require`, `package`, `ffi`, `debug`, `UIManager`, `arg`, `bmd.readfile/writefile/readdir` are nil; `os` keeps `clock date difftime getenv time tmpname`; `print` output is invisible. Working: `setfenv`, `getfenv`, `loadfile`, `dofile`, `loadstring`, `load`, `pcall`, `xpcall`, `coroutine`, `bit`, `lpeg`, the 28 `bmd.*` keys of the Console list (`wait` sleeps, `gettime` is float seconds), the Resolve API, and `fusion:GetPrefs/SetPrefs/SavePrefs`. The host runs **in-process** (`bmd.getpid()` is Resolve's pid), the script environment is `_G` (which has a metatable), and `resolve`, `fusion`, `fu`, `app` are userdata globals (one `FusionUI` object behind the last three). `SavePrefs` returns nil, takes 1 to 6 ms even at 512 KB, writes a new inode each time; keys survive Resolve's own saves, a quit and a relaunch; in-memory `SetPrefs` state is shared across menu-script runs. `Workspace > Scripts` lists a newly copied `.lua` without a restart. `Global.Script.AllowAutomaticScripts = 0` does not stop menu scripts.
- `Fusion.prefs` (the response channel) is at `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs` (about 22 KB, Lua-table text, mode 0666, one profile).
- User Utility folder: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/` (user-owned; since Step 1 it holds the stamped copy of `claude_diag.lua`). This is the **only** Resolve location this project may write to; the server self-installs its two Lua files there and nowhere else.
- `fuscript` at `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript` runs plain Lua from a terminal with a full, unsandboxed LuaJIT (`fuscript -l lua -x '...'`). It is the Lua test runner.
- Claude Desktop 2.2553.1 (Electron 44.2.0). Extensions live in `~/Library/Application Support/Claude/Claude Extensions/<id>/`; nine registry extensions here are `type: node` launched with Claude's own Node; one local `type: uv` bundle ran only because Claude found the user's `~/.local/bin/uv`. Per-server logs: `~/Library/Logs/Claude/mcp-server-<Display Name>.log`. `claude_desktop_config.json` (mode 0600) has one other server (`notebooklm`); the developer loop merges into it, never clobbers, backs up first.
- Node v24.0.1 and v22.15.0 via nvm (`. ~/.nvm/nvm.sh`), npm 11.7.0; `@modelcontextprotocol/server` 2.0.0 and `@modelcontextprotocol/client` 2.0.0 (the stable v2 line since the 2026-07-28 spec; `zod ^4.2`, Node >= 20; the single `@modelcontextprotocol/sdk` 1.30 package is legacy), esbuild 0.28.2, `@anthropic-ai/mcpb` 2.1.2 via `npx`. `/usr/bin/python3` is unusable (Xcode licence prompt); Python is not used by the server.

## Architecture (protocol v1; docs/plan.md has the full reference)

```
Claude Desktop --stdio--> MCPB "DaVinci Resolve (Lua bridge)" = node ${__dirname}/server/index.js
      | writes <state_dir>/next.lua (tmp + rename): return {v, id, session, op, ts, code=[==[...]==]}
      | polls  ~/Library/.../Fusion/Profiles/*/Fusion.prefs for RLBResp = "<id>:<hex json>"
      | deletes next.lua after the response (Lua cannot delete files)
      | first run: copies bridge/resolve_lua_bridge.lua + scripts/claude_diag.lua into the user Utility folder
      v
bridge/resolve_lua_bridge.lua (Scripts-menu Lua state, holds live `resolve`)
      loop: bmd.wait(0.05); bmd.fileexists -> loadfile -> new id & our session? ->
            loadstring+setfenv+xpcall with captured print -> SetPrefs(RLBResp)+SavePrefs
      RLBSession written once at start; no fusion: calls while idle; stop = op="stop"; takeover = session mismatch
```

Layout: `manifest.json` (MCPB v0.4), `package.json`, `tsconfig.json`, `.mcpbignore`, `src/` (`index.ts`, `server.ts` with the 15 tools, `config.ts`, `protocol.ts`, `prefs.ts`, `lua.ts`, `docsSearch.ts`, `bridgeInstall.ts`, `log.ts`), `server/index.js` (esbuild output, git-ignored, shipped), `bridge/resolve_lua_bridge.lua` (one dependency-free file, under 600 lines), `scripts/` (`claude_diag.lua`, `dev-register.mjs`, `smoke.mjs`), `tests/` (`node --test` via `tsx`; `tests/lua/` under `fuscript`), `dist/` (packed bundle, git-ignored), `Makefile`, `README.md`.

Runtime state: `RLB_STATE_DIR` (default `~/.resolve-lua-bridge/`, 0700) holding `next.lua`, `next.lua.tmp`, `lock` (pid, O_EXCL), `server.log`. No queue subdirectories, no heartbeat file, no stop file.

## Commands

Until the Makefile exists, the two commands that matter:

- `"/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript" -l lua -x 'assert(loadfile("<abs>/scripts/claude_diag.lua")); print("ok")'` - Lua syntax check (absolute paths; the tool prints a two-line banner on stdout, filter it with `grep -v -e '^DaVinci Resolve Script' -e '^Copyright'`).
- `HOME=<scratch>/home RLB_DIAG_LOOP_SECONDS=1 <fuscript> -l lua <abs>/harness.lua` - run a Lua file under stub Resolve/Fusion objects; the Step 1 harness was scratch-only, so `tests/lua/` recreates the stubs (colon-callable tables with a metatable, lists carrying `__flags`, a `fusion` stub with `GetPrefs/SetPrefs/SavePrefs/MapPath` over a nested table serialised with `%q`).

Planned targets (update this section once they are real):

```sh
make build         # tsc --noEmit + esbuild -> server/index.js
make test          # node --test (tsx) + fuscript -l lua tests/lua/run_tests.lua + grep checks on the bridge
make bundle        # build + mcpb validate + mcpb pack . dist/resolve-lua-bridge.mcpb + mcpb info
make install       # bundle, then open the .mcpb so Claude Desktop shows its install dialog
make dev-register  # developer loop: merge a claude_desktop_config.json entry pointing at server/index.js
make smoke         # against live Resolve + running bridge; only touches a timeline named bridge-smoke it creates
make stop          # sends the stop request to the bridge
make uninstall-bridge  # removes the two Lua files from the user Utility folder
```

## Project-specific rules

Mirror of `docs/plan.md` "Safety and behaviour rules" (the original spec's rules plus those learned in Step 0). Not negotiable without the user's say-so; if the two ever differ, `docs/plan.md` wins.

- **stdout is the MCP transport.** Log with `console.error` and the file log only; `console.log` is never called anywhere in `src/`.
- **No network listeners of any kind.** Files in, prefs out.
- **Never modify anything under `/Applications` or `/Library`** without asking. The server writes to the user Utility folder only (its two Lua files) and never creates Resolve's folders; if the folder is missing it reports that through `resolve_status`. Running `fuscript` read-only is fine.
- **Destructive tools** take `confirm: bool = False` and refuse when false. Never run destructive Resolve operations during development except on timelines, bins or projects the tests created.
- **When the user must click something in Resolve or Claude Desktop, stop and ask.** Do not assume it happened.
- **Never launch the bridge loop via `fusion:Execute` or a startup `.scriptlib`** (it holds Fusion's shared script executor for the session). Scripts-menu launch only.
- **The bridge never writes prefs while idle** and never on error paths during shutdown. Prefs writes happen only in response to a request, plus one `RLBSession` at start and one on clean stop.
- The bridge never deletes files (it cannot), never calls `os.exit`, never blocks longer than one request, and stays dependency-free.
- Responses are capped (64 KB of JSON by default, 192 KB hard ceiling, before hex) because every `SavePrefs` rewrites a 22 KB file Resolve loads at startup; list tools paginate with `offset` + `limit`.
- **Every MCP tool declares `title` and `annotations`**: read-only tools `readOnlyHint: true`; `run_lua` and `delete_markers` `destructiveHint: true`; all `openWorldHint: false`. Descriptions describe; cross-tool guidance lives in the server `instructions` string, never in descriptions. Handlers never throw: every failure is an `isError` result that names the next step.
- **Every string a tool embeds in a Lua chunk goes through the one `luaString()` escaping helper.** Tool inputs are untrusted even though Claude sends them. Enums are zod enums, ints are bounded, list tools take a `limit`. The server never spawns a process.
- **The manifest's `tools[]` list stays identical to the server's `tools/list`** (a test enforces it). The manifest is `manifest_version "0.4"`, `platforms ["darwin"]`, `runtimes.node ">=20.0.0"`; code uses only Node 20 APIs.
- Framework is the v2 TypeScript SDK: `McpServer` from `@modelcontextprotocol/server`, `registerTool` with `z.object(...)` schemas from `zod/v4`, `serveStdio` from `@modelcontextprotocol/server/stdio`, tests with `InMemoryTransport` (from `@modelcontextprotocol/server`) + `Client` (from `@modelcontextprotocol/client`). Not the legacy `@modelcontextprotocol/sdk` 1.x, not Python. See `docs/plan-review-2026-09.md` §§ J-K and research 13.8.
- Commit after each step with a clear message.

## Lua conventions the bridge and tools must respect

- **Before writing any Lua, read the official Resolve scripting documentation in `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/` and treat it as the source of truth**: `DaVinciResolveScript.pyi` for every method signature, argument order, return shape and enum (quote it, do not recall it); `README.md` for calling conventions, list/dict semantics, the Studio/AI section and the Deprecated and Unsupported sections; `CHANGELOG.md` for what 21.1 added; `Examples/*.lua` for idioms only (they use deprecated calls). Read-only: never modify anything in that folder. Where the docs are silent (the Lua host's libraries, `bmd.*`, `fusion:*Prefs`, the free-edition sandbox), say so and rely on the measurements in `docs/plan.md` and research § 3.
- Lua 5.1 (LuaJIT): colon calls on API objects, 1-indexed tables, `return` to send a value back. `xpcall(f, handler)` takes no extra arguments in 5.1, so wrap calls in a closure; `debug` is nil in the menu host, so the handler falls back to `tostring` when `debug.traceback` is absent.
- Obtain `resolve` with a plain global read (not `rawget`, a metatable on `_G` would hide it), then `Resolve()` if that is a function (the shipped examples' form), then `bmd.scriptapp("Resolve")`. `fusion` is the first of the `fusion`, `fu`, `app` globals that has a `SetPrefs` method, else `resolve:Fusion()` (measured: all one object).
- Resolve "lists" are 1-indexed plain tables that carry `__flags = 4194304` (measured on every list; strip it; iterate with `for i = 1, #list`, never `pairs`); "dicts" are plain tables without `__flags`, keyed by name, and some (`GetMarkers()`) by integer frame. API objects are userdata: `pairs` and `#` throw on them, `==` works between two fetches of the same object. Encoder rules: a table is a JSON array only when its keys are exactly 1..n; any other integer-keyed table is an object with string keys; userdata, functions and tables with a metatable become a `tostring()` placeholder, never a crash. Numbers: integral (`n == math.floor(n)`, never `%d`, which silently truncates 3.5 to 3 under LuaJIT) and below 2^53 -> `%.0f`, else `%.17g`; NaN/inf become null. `GetSettings()` returns the frame rate as a number and resolution as strings and has no `useCustomSettings` key on this build; `AddRenderJob()` returns `""` on failure, which is truthy in Lua, so check `#jobId > 0`; check every boolean the API returns. Marker frames are relative to the timeline start (measured). `AddSubFolder` makes the new folder current and allows duplicate names, so look bins up by name first and restore with `SetCurrentFolder`; `CreateEmptyTimeline` makes the new timeline current inside the current folder.
- An empty Lua table encodes as `{}` (the encoder cannot tell an empty list from an empty dict), so the server treats `{}` as `[]` wherever a list is expected, and tests assert with `Array.isArray(x) ? x : []`.
- `bmd.readstring`/`bmd.writestring` are Lua-table serialisers, not file I/O.
- The Console and the Scripts-menu host are different states; the menu host is what the bridge runs in, and Step 1 measured it on this Mac (`docs/diagnostic-2026-09.md`): the same library set as the Console plus `setfenv`/`getfenv`, minus `debug`. Blackmagic's docs say nothing about the host's libraries, `bmd.*`, `fusion:*Prefs` or the free-edition sandbox; those facts are measured, not documented, and a point release can change them.
- Lua never expands `~`: build every path from `os.getenv("HOME")` or the `RLB_STATE_DIR` header the server stamps into the Lua files at copy time. Page names for `OpenPage` are lowercase. `LoadProject` on a dirty project can raise a modal the bridge cannot answer, so `open_project` saves first by default and interactive render mode stays off. The shipped `Examples/*.lua` use deprecated calls and `os.exit`; they are reference for conventions only, the `.pyi` is the signature source.

## Working in this repo

- A user-level PreToolUse hook blocks any Bash command whose text contains the literal `node_modules`, even inside `find -not -path` filters or heredoc bodies. Build the string at run time (`NM="node_""modules"`) or use the Write/Edit tools; do not retry the same command.
- Source nvm before Node tooling: `. ~/.nvm/nvm.sh` then `node`/`npm`/`npx`. The `compdef:153: _comps: assignment to invalid subscript range` line they print is harmless zsh completion noise.
- `fuscript -l lua <file>` runs the main script in a sandbox environment whose `__index` is `_G`, while `dofile`'d chunks run in `_G` itself; a test harness therefore installs stubs with `rawset(_G, "resolve", stub)` and removes `Resolve`/`bmd.scriptapp` with `rawset` before `dofile`. Plain global assignments in the harness are invisible to the chunk under test. `Resolve()` under `fuscript` returned nil on this Mac (external scripting is off on free), but a harness must still remove it. Absolute paths everywhere; `fuscript` inherits the environment, so `HOME=<dir>` redirects `os.getenv("HOME")`.
- Decoding a diagnostic or bridge payload from `Fusion.prefs`: keys are serialised in hash order, so match `\bRLBDiag = "([0-9a-f]*)"` (the `Prev` variant cannot match because the next character is `P`), hex-decode to UTF-8 with a non-fatal decoder, then `JSON.parse`. Fusion writes strings with `\"`, `\\`, `\n` and raw tabs and UTF-8.
- Grep checks for forbidden calls (`os.exit`, `require`, `fusion:Execute`) must skip comment lines (`grep -v '^\s*--'`); a header comment tripped the `os.exit` check once.
- Foreground `sleep` is blocked in the Bash tool. A long-running observer goes via `nohup zsh script.sh args >/dev/null 2>&1 &` then `disown`, writes its pid to a file, and is killed explicitly at the end.
- macOS `date` has no `%N` and `awk` has no `strftime`: use zsh `zmodload zsh/datetime; $EPOCHREALTIME` for sub-second stamps and `date -r <epoch> '+%H:%M:%S'` to format one.
- To compare two `Fusion.prefs` files, strip the `RLB` lines and leading whitespace, `sort`, then `diff`: Fusion serialises sections in hash order and emits trailing commas inconsistently, so a plain diff is noise.
- Multi-line commit messages: `git commit -q -F - <<'EOF' ... EOF` avoids quoting problems.
- TypeScript SDK docs and versions: Context7 id `/modelcontextprotocol/typescript-sdk` (its `main` branch) is the current v2; ignore `__branch__v1.x`. Check versions by the v2 package names (`npm view @modelcontextprotocol/server version`); `npm view @modelcontextprotocol/sdk` only shows the legacy 1.x line and misled a previous session.
- Claude Desktop launch diagnostics: `grep -h '\[MCP Launch\]\|\[UV Discovery\]' ~/Library/Logs/Claude/main*.log` shows how the host resolved and started an extension; installed manifests are at `~/Library/Application Support/Claude/Claude Extensions/<id>/manifest.json`. The host resolves the user's full login PATH for servers but maps bare `node` to its bundled Node.
- `.claude/settings.json` enables the `mcp-server-dev` plugin for this repo; its `build-mcpb` skill is the packaging reference for Step 4 and `build-mcp-server` the tool-design reference.
- Large reference sources (AutoSubs `autosubs_core.lua`, the MCPB schema) go into the session scratchpad via `curl`, then `grep`/`sed -n` the relevant lines; never fetch them whole into context.
