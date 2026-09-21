# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

`davinci-resolve-lua-mcp` is an MCP server, shipped as an MCPB bundle for Claude Desktop, that
controls the free edition of DaVinci Resolve 21.1 on macOS. Free 21.1 has no Python and no external
scripting, and Blackmagic's own MCP server is Studio-only. The one door left is a Lua script launched
from `Workspace > Scripts` inside Resolve: it receives the live `resolve` object and runs as a
long-lived in-app bridge that executes Lua for the server. Requests are a file the bridge reads with
`loadfile`; responses go back through `fusion:SetPrefs` + `fusion:SavePrefs()`, which the server
reads from `Fusion.prefs` on disk. The server is TypeScript on the v2 SDK
(`@modelcontextprotocol/server`), bundled by esbuild into one CJS file that Claude Desktop runs with
its own Node. Version 0.1.0 is the first public release.

`README.md` is the user documentation (install, start and stop, the 15-tool table with the `run_lua`
guide, the settings and `RLB_*` variables, troubleshooting, security, uninstall, the make targets);
do not repeat it here. `SECURITY.md` is the reporting policy. The planning documents were removed
before release, so this file and the code comments are the design record.

## Rules

Not negotiable without the user's say-so.

- Architecture-level changes (the request file, the prefs response channel, the trust boundary, what
  runs inside Resolve, the runtime, the distribution format) are presented to the user as a tradeoff
  first. Implementation-level improvements can be adopted directly, with a note in a comment or here.
- stdout is the MCP transport: `console.error` and the file log only, never `console.log` in `src/`.
- No network listeners of any kind. Files in, prefs out.
- Never modify anything under `/Applications` or `/Library` without asking; Blackmagic's docs folder
  is read-only. The server writes only its state dir and the user Utility folder (its two Lua files)
  and never creates Resolve's folders.
- Destructive tools take `confirm: bool = false` and refuse when false. Development never runs
  destructive Resolve operations except on objects the tests created; smoke runs and mutating Lua go
  only to a scratch project the user names, never to a real edit.
- When the user must click something in Resolve or Claude Desktop, stop and ask; never assume it
  happened. `make install` and `make dev-register` (it edits the real Claude config) only on request.
- Never launch the loop via `fusion:Execute` or a startup `.scriptlib` (either holds Fusion's shared
  script executor for the session). Scripts-menu launch only.
- The bridge never writes prefs while idle (only per request, plus one `RLBSession` at start and one
  on clean stop), never deletes files, never calls `os.exit`, never blocks longer than one request,
  and stays one dependency-free file under 600 lines.
- Responses are capped and list tools paginate (`offset` + `limit`): every `SavePrefs` rewrites a
  ~22 KB file that Resolve loads at startup.
- Every tool declares `title` and `annotations` (read-only tools `readOnlyHint`; `run_lua` and
  `delete_markers` `destructiveHint`; all `openWorldHint: false`). Descriptions describe; cross-tool
  guidance lives in the server `instructions` string. Handlers never throw: every failure is an
  `isError` result that names the next step.
- Every string embedded in a Lua chunk goes through `luaString()` in `src/lua.ts`. Inputs are
  untrusted: zod enums, bounded ints, a `limit` on list tools. `src/` never spawns a process (the grep
  gate covers `src/` only; scripts and tests may spawn).
- The manifest `tools[]` equals `tools/list`, and the versions in `package.json`, `manifest.json` and
  `SERVER_VERSION` (`src/server.ts`) agree; one test enforces both.
- v2 TypeScript SDK only (`McpServer`, `registerTool` with `zod/v4`, `serveStdio`; `InMemoryTransport`
  + `Client` in tests); never the legacy `@modelcontextprotocol/sdk` 1.x, never Python.
- Where Blackmagic's docs are silent (the host's libraries, `bmd.*`, `fusion:*Prefs`, the sandbox),
  say so and rely on the measurements under "Resolve: measured facts".
- Run `make test` before a commit; commit after each unit of work with a clear message.

## Environment traps

- A user-level PreToolUse hook blocks any Bash command whose text contains the literal
  `node_modules`, even inside filters or heredocs. Build the string at run time
  (`NM="node_""modules"`) or use Write/Edit; never retry the same command.
- Another hook rejects any Bash command that names the memory directory or contains the word itself.
  Read and write memory files with the Read/Write tools only.
- Source nvm before Node tooling: `. ~/.nvm/nvm.sh`. The `compdef:153: _comps: assignment to invalid
  subscript range` line is harmless zsh noise. The Makefile sources nvm itself unless `CI` is set.
- Foreground `sleep` is blocked in the Bash tool. A long-running observer goes via
  `nohup zsh script.sh args >/dev/null 2>&1 &` then `disown`, writes its pid to a file, and is killed
  explicitly at the end.
- In the Bash tool (zsh), `${pipestatus[1]}` is the exit code of a pipeline's first command.

## Architecture (protocol v1)

```
Claude Desktop --stdio--> MCPB "DaVinci Resolve Lua MCP" = node ${__dirname}/server/index.js
      | writes <state_dir>/next.lua (tmp + rename): return {v, id, session, op, ts, code=[==[...]==]}
      | polls  ~/Library/.../Fusion/Profiles/*/Fusion.prefs for RLBResp = "<id>:<hex json>"
      | deletes next.lua after the response (Lua cannot delete files)
      | first run: copies bridge/resolve_mcp_bridge.lua + scripts/claude_diag.lua into the user Utility folder
      v
bridge/resolve_mcp_bridge.lua (Scripts-menu Lua state, holds live `resolve`)
      loop: bmd.wait(0.05); bmd.fileexists -> loadfile -> new id & our session? ->
            loadstring+setfenv+xpcall with captured print -> SetPrefs(RLBResp)+SavePrefs
      RLBSession written once at start; no fusion: calls while idle; stop = op="stop"; takeover = session mismatch
      run needs the exact session id ("*" is for ping and stop only); a failed start save is retried once a second
```

- Prefs keys sit under `Global.ResolveLuaBridge.`: `RLBResp`, `RLBSession`, and the diagnostic keys
  (`RLBDiag*`, `RLBMem`, `RLBLoop`, `RLBProbe*`) the bridge clears at start. The `RLB_*`/`RLB*` names
  and this prefix predate the project's rename and stay on purpose: installed scripts depend on them.
- Caps: 64 KB of JSON by default, 192 KB hard ceiling (before hex); prints 200 lines, 16 KB, 2048
  bytes per line (constants in the bridge's `PRINT_MAX_*`/`MAX_KB_*` block and `src/config.ts`). Only
  the chunk's first return value is sent (`extra_returns`); dropped prints count in `prints_dropped`.
- The bridge resolves its state dir as stamp > `RLB_STATE_DIR` env > `HOME` > `MapPath("Profile:")`;
  a `state_dir_match` of false in `resolve_status` means a hand-copied or stale script. After three
  consecutive failed runs where `GetVersionString` also fails, the loop exits (status `no_reply`,
  `pid_alive` true).
- Runtime state: `RLB_STATE_DIR` (default `~/.davinci-resolve-lua-mcp`, 0700) holds `next.lua`,
  `next.lua.tmp`, `lock` (a pid file hard-linked into place, taken per request, absent while idle),
  `lock.takeover` (exists only during the takeover of a dead holder's lock; one older than 30 s is
  abandoned and removed) and `server.log`. No queue directories, no heartbeat file, no stop file.
- Layout: `src/` (ten modules; `main.ts` is the wiring, `server.ts` the tools, `lua.ts` the snippets,
  `protocol.ts` the slot and lock, `prefs.ts` the reader, `bridgeInstall.ts` the self-install),
  `server/index.js` (built, git-ignored, shipped), `bridge/resolve_mcp_bridge.lua`, `scripts/`
  (`claude_diag.lua` ships; `gen-types.mjs`, `dev-register.mjs`, `smoke.mjs` are developer-only),
  `types/resolve_host.d.lua` + `.luarc.json` (Lua LSP), `tests/`, `docs/images/` (README screenshots;
  the MP4 recordings are git-ignored, GitHub-hosted), `.github/workflows/tests.yml`, `SECURITY.md`.
  `tsconfig.json` covers `src/` and `tests/` only. The bundle is exactly the eight files allowlisted
  in `tests/check_bundle.sh`; anything new goes into `.mcpbignore` (directories without trailing
  slashes: `mcpb pack` walks with the `ignore` package after built-in excludes that do not cover
  `node_modules`, `.claude`, `.remember` or `.out`).

## Commands, CI and releasing

Targets (`Makefile`; the README has the table): `test` = `test-lua` + `test-node`; `check-bridge`,
`lint-lua`, `gen-types`; `build`, `typecheck`, `check-server`, `inspect`, `bundle`, `clean`;
`install`, `sign`, `dev-register`/`dev-unregister`, `uninstall-bridge`; `smoke`, `stop`.

- `fuscript` exits 0 whatever the script does, so `make test-lua` passes only on the
  `RLB_TESTS_RESULT: PASS` marker line.
- `make inspect` spawns the server with a filtered environment: production paths and the first-run
  self-install into the real Utility folder. Otherwise drive the built server by hand: pipe JSON-RPC
  lines (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) into
  `RLB_STATE_DIR=<tmp> RLB_AUTO_INSTALL=false node server/index.js`; answers come back one per line
  on stdout, the log on stderr; in-flight calls finish after stdin closes (5 s grace).
- Syntax check of one Lua file: `fuscript -l lua -x 'assert(loadfile("<abs>/f.lua")); print("ok")'`,
  with the two-line banner filtered by `grep -v -e '^DaVinci Resolve Script' -e '^Copyright'`.
- `make smoke SMOKE_PROJECT="<open project>"` mutates the named project (a `bridge-smoke` timeline,
  the render TargetDir/CustomName, which the API cannot read back, hence the name must equal the open
  project's). `SMOKE_FLAGS=--no-render`, `--timeout <s>`; logs under `.out/`. The lock is per
  request, so it runs alongside the installed extension; `lock_held` names a pid whose request
  outlasted the wait (or a stale lock whose pid is alive). Without `--project`, `scripts/smoke.mjs` is
  the read-only coexistence check. A 10-minute watchdog fails the run when a modal in Resolve wedges
  the bridge; the `Manual cleanup in Resolve:` line names what to delete by hand. The run refuses
  until the installed script equals the repo's: the server compares the stamped files byte for byte,
  so any edit to the bridge or `claude_diag.lua` reports `updated` on the next start and the user
  must relaunch `Workspace > Scripts > resolve_mcp_bridge`.
- `make bundle`: two packs give the same file list but different bytes (zip mtime); compare with
  `zipinfo -1`. `mcpb` is the pinned local binary, never `npx` (unreliable on npm 11). `make sign` is
  optional and self-signed.
- `make dev-register` merges a `davinci-resolve-lua-mcp-dev` entry into the real config after backing
  it up (flags in the script). A code change then needs `make build` and a Claude Desktop restart.
- CI (`.github/workflows/tests.yml`) runs `make test-node` and `make bundle` on macOS with Node 20
  and 24. The Lua tests and the smoke test need Resolve and stay local.
- Releasing: bump `package.json` (`npm version --no-git-tag-version`), `manifest.json` and
  `SERVER_VERSION`; when the Lua changed, also the bridge header (line 1 and `VERSION`),
  `claude_diag.lua` (line 1 and `SCRIPT`), `BRIDGE_TAG` in `tests/helpers/fakeBridge.ts` and the
  envelope in `tests/prefs.test.ts`. Then `make lint-lua`, `make test`, `make bundle`, CI green,
  `make install` (the user's click), the user relaunches the script, `make smoke` on a scratch
  project, tag `vX.Y.Z`, a GitHub Release with `dist/*.mcpb` attached (never committed) and its
  sha256 in the notes. `SECURITY.md` promises support for the latest release only.

## Tests

- Lua harness (`tests/lua/`): `fuscript -l lua <file>` runs the main script in a sandbox whose
  `__index` is `_G`, while `dofile`d chunks run in `_G` itself, so stubs go in with `rawset(_G, ...)`,
  `Resolve` and `bmd.scriptapp` are removed with `rawset`, `bmd` is replaced (`wait` a no-op,
  `gettime` a clock the tests advance) and `HOME` is redirected through the environment. The bridge
  is loaded with `assert(loadfile(path))("RLB_BRIDGE_TESTING")`, a vararg the menu host never passes,
  which makes it return its internals instead of starting the loop; `start({resolve, fusion,
  state_dir, getenv})` injects the rest. `dkjson` and `io` come from `rawget(_G, "require")` and
  `rawget(_G, "io")` because `.luarc.json` disables `package` and `io`. Absolute paths everywhere.
- `tests/lua/check_bridge.sh` gates: under 600 lines (nine of headroom today), the two header lines,
  the stamp literal, forbidden names on comment-stripped lines, and exactly one `:SetPrefs(`,
  `:SavePrefs(`, `:GetPrefs(` call site each. A new prefs call or a `debug.`/`io.` reference fails by
  design: reach `debug` through `gread`, keep prefs writes inside `set_pref`/`save_prefs`.
- Node suite (`node --test` through `tsx`): never touches `~/Library` or `/Library`; the `RLB_*`
  directories point at `tests/helpers/tmp.ts` temp dirs; `tests/helpers/fakeBridge.ts` answers
  `next.lua` by rewriting a Fusion-format prefs file and models the bridge's failure modes; tool
  tests use a recording `Bridge` stub (`createServer` takes the interface) and assert on the captured
  Lua; the `fuscript`-backed tests skip themselves when Resolve is absent. Test files cannot use
  top-level `await` (CJS); use `existsSync` for skips. Files run concurrently, so after touching the
  locking in `protocol.ts` loop the suite:
  `for i in 1 2 3 4 5 6 7 8; do node --import tsx --test tests/*.test.ts | grep -q '^✖' && echo FAIL; done`
- `tests/check_server.sh` greps `src/` (no `console.log`, `process.stdout`, `child_process`, network
  modules, `.listen(`, raw template holes in Lua strings, plus the vendor-name gate it explains);
  `tests/check_bundle.sh` checks the packed file list, size under 2 MB and a stdio `tools/list` probe
  of the unpacked server under a temp state dir with the self-install off.
- `make lint-lua`: `gen-types.mjs --check` (stale means `make gen-types`), then `lua-language-server
  --check` at Warning level as JSON in `.out/luals-check.json`; the server exits 1 whenever any
  diagnostic exists, so the target greps the report for `bridge/` and `tests/` (rc 127: binary
  missing). Accepted: `claude_diag.lua` keeps its `need-check-nil` warnings and one deliberate
  undefined `io` probe. Probe the generated types with a scratch `.lua` under the repo, then delete it.

## Resolve: measured facts

Measured on the free edition this project targets (21.1). Blackmagic documents none of the host
facts; a point release can change them.

- The scripting docs ship at
  `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/` (`README.md`,
  `CHANGELOG.md`, `DaVinciResolveScript.pyi`, `Examples/`, `Modules/`), read-only. The README there
  has no API tables: the `.pyi` is the signature reference (quote it, do not recall it).
- Point release: compare the `*Last Updated:*` line of the shipped README and the CHANGELOG, then
  `make gen-types` and `make lint-lua`. `parseReadmeLists` in the generator and `DEPRECATED_SECTIONS`
  in `src/docsSearch.ts` key on the exact README headings for deprecated and unsupported names, so a
  renamed heading silently drops the tags. The Node tests use fixtures: a real docs change is caught
  only by `make lint-lua` and the `scripting_api_docs` check in `make smoke`. Re-measure the sandbox
  by running `claude_diag` from the Scripts menu in a scratch project and decoding `RLBDiag`; the
  `bmd` class in `types/resolve_host.d.lua` is hand-written.
- The Scripts-menu Lua state is sandboxed. nil: `io`, `os.execute`, `os.remove`, `os.rename`,
  `require`, `package`, `ffi`, `debug`, `UIManager`, `arg`, `bmd.readfile/writefile/readdir`; `os`
  keeps `clock date difftime getenv time tmpname`; `print` output is invisible. Working: `setfenv`,
  `getfenv`, `loadfile`, `dofile`, `loadstring`, `load`, `pcall`, `xpcall`, `coroutine`, `bit`,
  `lpeg`, the 28 `bmd.*` keys of the Console list (`wait` sleeps, `gettime` is float seconds), the
  Resolve API, and `fusion:GetPrefs/SetPrefs/SavePrefs`. The host runs in-process (`bmd.getpid()` is
  Resolve's pid), the script environment is `_G` (which has a metatable), and `resolve`, `fusion`,
  `fu`, `app` are userdata globals (one `FusionUI` object behind the last three). The Console is a
  different state: the menu host has its library set plus `setfenv`/`getfenv`, minus `debug`.
- `SavePrefs` returns nil, takes single-digit milliseconds even at 512 KB and writes a new inode each
  time; keys survive Resolve's own saves, a quit and a relaunch; in-memory `SetPrefs` state is shared
  across menu-script runs. `Workspace > Scripts` lists a newly copied `.lua` without a restart.
  `Global.Script.AllowAutomaticScripts = 0` does not stop menu scripts. `Fusion.prefs` is
  `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs`
  (about 22 KB of Lua-table text, mode 0666, one profile).
- The user Utility folder
  `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/` is the
  only Resolve location this project writes. `fuscript` at
  `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript` runs plain
  Lua from a terminal with a full, unsandboxed LuaJIT (`-l lua -x '...'`) and is the Lua test runner.
- Measured live: a second click of the script takes over cleanly (the old loop exits on the first
  request for the newer session); with live save on, `open_project` with `save_current=false` neither
  prompts nor loses work (live save is a user preference, not a `GetSettings()` key); `LoadProject`
  on a dirty project can raise a modal the bridge cannot answer, so `open_project` saves first by
  default and interactive render mode stays off.

## Lua conventions

- Before writing any Lua, read the shipped docs: the `.pyi` for every signature, argument order,
  return shape and enum; the README for calling conventions and the Deprecated and Unsupported
  sections; `Examples/*.lua` for idioms only (they use deprecated calls and `os.exit`). Colon calls,
  1-indexed tables, lowercase page names, `return` to send a value: see the README's `run_lua` guide.
- Lua 5.1 (LuaJIT): `xpcall(f, handler)` takes no extra arguments, so wrap calls in a closure;
  `debug` is nil, so the handler falls back to `tostring` when `debug.traceback` is absent.
- Obtain `resolve` with a plain global read (not `rawget`; the `_G` metatable would hide it), then
  `Resolve()` if that is a function, then `bmd.scriptapp("Resolve")`. `fusion` is the first of
  `fusion`, `fu`, `app` with a `SetPrefs` method, else `resolve:Fusion()`.
- Resolve "lists" are 1-indexed tables carrying `__flags = 4194304` (strip it; iterate with
  `for i = 1, #list`, never `pairs`); "dicts" are plain tables keyed by name, some (`GetMarkers()`) by
  integer frame. API objects are userdata: `pairs` and `#` throw, `==` works between two fetches.
- Encoder rules: a table is a JSON array only when its keys are exactly 1..n; any other integer-keyed
  table becomes an object with string keys; userdata, functions and metatabled tables become a
  `tostring()` placeholder, never a crash. Integral numbers below 2^53 use `%.0f`, others `%.17g`,
  never `%d` (it silently truncates 3.5 to 3 under LuaJIT); NaN and inf become null.
- An empty table encodes as `[]` when it carried `__flags` (an empty API list) and as `{}` otherwise,
  so the server treats `{}` as `[]` wherever a list is expected and tests assert with
  `Array.isArray(x) ? x : []`.
- API quirks: `GetSettings()` returns the frame rate as a number and resolution as strings and has no
  `useCustomSettings` key; `AddRenderJob()` returns `""` on failure, which is truthy, so check
  `#jobId > 0`; check every boolean the API returns; marker frames are relative to the timeline
  start; `AddSubFolder` makes the new folder current and allows duplicate names (look bins up by name
  first, restore with `SetCurrentFolder`); `CreateEmptyTimeline` makes the new timeline current.
- `bmd.readstring`/`bmd.writestring` are Lua-table serialisers, not file I/O.
- Lua never expands `~`: build every path from `os.getenv("HOME")` or the `RLB_STATE_DIR` header the
  server stamps into the Lua files at copy time. The contract spans the bridge (the
  `[==[@@RLB_STATE_DIR@@]==]` literal and the line-2 comment), `stateDirStampProblem()` in
  `src/config.ts` (refuses `]==]`, `"`, `\`, CR/LF and a leading `@@`), `src/bridgeInstall.ts`
  (replaces every occurrence) and `check_bridge.sh`.

## TypeScript conventions

- CJS package (no `"type": "module"`), `tsconfig` `module: NodeNext` in CJS mode: relative imports
  end in `.js`, `__dirname` works. `@types/node` is pinned to 20 so `tsc` rejects newer APIs.
  `import * as z from 'zod/v4'`; `InMemoryTransport` comes from `@modelcontextprotocol/server`,
  `Client` from `@modelcontextprotocol/client`. `outputSchema` uses `z.looseObject` because the v2
  client rejects extra keys in `structuredContent` against a strict `z.object`; `isError` results
  skip output validation. Context7 id `/modelcontextprotocol/typescript-sdk` (`main`) is the v2 SDK;
  check versions with `npm view @modelcontextprotocol/server version` (`npm view
  @modelcontextprotocol/sdk` shows only the legacy line).
- `main(options)` in `src/main.ts` is the wiring; `src/index.ts` is `void main()`. Its three hooks are
  a stable extension surface for downstream builds that import `main`, no-ops by default:
  `wrapServer` (applied in the `serveStdio` factory right after `createServer`; must return that
  `McpServer` or a Proxy over it, `serveStdio` checks `instanceof`), `onToolFailure` (called from
  `guard(tool, fn)` in `server.ts` wherever a thrown `BridgeError` becomes an `isError` result; never
  on success, never for Lua-side failures, never from `resolve_status`; a throw inside it is logged
  and ignored) and `beforeExit` (awaited on every exit path behind a ref'd 2 s timer, ref'd on
  purpose so Node cannot exit before `exit(code)`). `options.runtime` (`env`, `proc`, `transport`,
  `beforeExitCapMs`) is a test seam: `tests/main.test.ts` drives `main()` in-process with a fake
  `EventEmitter` process and the server half of `InMemoryTransport.createLinkedPair()`. Never register
  on the real `process` in a test: a `node --test` child's stdin ends at once and would arm a real
  `process.exit`.
- The request-slot lock is per request, never held while idle: `BridgeClient.request()` takes it,
  waits up to the request's own timeout for a live holder, releases it in `finally`; `status()`
  reports the holder without the lock; `main.ts` takes it for a moment at startup to remove a
  leftover `next.lua`. Why: Claude Desktop launches the server several times on install and keeps one
  idle "era probe" sibling alive for the whole session, in utility processes with stdin on
  `/dev/null` (the stdin-closed exit path never fires there); a startup lock would be owned by that
  sibling for ever and every request would answer `lock_held`.
- `expandHome()` in `src/config.ts` expands a leading `~` and `${HOME}`, because Claude Desktop passes
  a `user_config.default` such as `${HOME}/.davinci-resolve-lua-mcp` to the server literally.
- Scripts that spawn the server use `StdioClientTransport` (`@modelcontextprotocol/client/stdio`),
  which gives the child `getDefaultEnvironment()` (`HOME LOGNAME PATH SHELL TERM USER`) plus the
  `env` option only, so every `RLB_*` variable is passed explicitly. `Client.callTool` returns
  `structuredContent` for `isError` results too, validates successes against `outputSchema` (a
  mismatch throws), and its default timeout is 60 s, the same as the render wait, so pass a timeout
  per call. `close()` ends stdin, then SIGTERM after 2 s, then SIGKILL; both exit paths release the
  lock.

## Claude Desktop

- Extensions live in `~/Library/Application Support/Claude/Claude Extensions/<id>/`; this one is
  `type: node`, run with Claude's bundled Node (the host resolves the user's login PATH but maps a
  bare `node` to its own).
- `~/Library/Logs/Claude/mcp-server-DaVinci Resolve Lua MCP.log` records the manager's connection
  (`initialize`, `tools/list`, era probes, shutdowns) but not the chat's tool calls; stderr is also
  copied into `main.log` as `[UtilityProcess stderr]`, and `grep -h '\[MCP Launch\]\|\[UV Discovery\]'
  ~/Library/Logs/Claude/main*.log` shows how an extension was resolved and started. To prove a tool
  ran, decode the last `RLBResp` (see "Working here").
- `claude_desktop_config.json` (mode 0600) may hold other servers; the dev loop merges into it and
  backs it up first, never clobbers.
- Reinstalling the same version shows no dialog: remove the extension under Settings > Extensions,
  then `open dist/davinci-resolve-lua-mcp.mcpb` (or `make install`). Verify from
  `~/Library/Application Support/Claude/extensions-installations.json` (`installedAt`, `hash` = the
  sha256 of the `.mcpb`) and the new `starting` lines in `~/.davinci-resolve-lua-mcp/server.log`
  (several per launch, one per probe sibling).

## Language servers: use them

Two LSP plugins back the `LSP` tool (line and character are 1-based and must sit on the identifier)
and the diagnostics block the harness appends after every Write or Edit of a `.lua`, `.ts` or `.mjs`
file.

- Lua: the `lua-lsp` plugin (project scope, `.claude/settings.json`) wires the tool to a
  `lua-language-server` on PATH (Homebrew). `.luarc.json` sets `runtime.version` to `LuaJIT` (so
  `setfenv`/`getfenv`/`bit` are legal and Lua 5.4 deprecation warnings are wrong) and disables `io`,
  `ffi`, `debug` and `package` to mirror the sandbox (`os.execute`/`os.remove` cannot be disabled per
  key; the grep gates guard those). Host globals live in `types/resolve_host.d.lua`: the 28 `bmd` keys
  as a closed class, `Resolve` and `Fusion` (`Execute`/`RunScript` marked `@deprecated`), and the
  block between the `BEGIN GENERATED`/`END GENERATED` markers generated from the `.pyi` by
  `scripts/gen-types.mjs`. Never edit that block by hand: change the generator, run `make gen-types`.
  A method the LSP does not know means the `.pyi` changed. Never add a name to `diagnostics.globals`
  (it mutes typos). Claude Code's LSP client answers no configuration requests, so `.luarc.json` is
  the only channel; the server picks up file changes within a minute.
- TypeScript: the `typescript-lsp` plugin (user scope) runs `typescript-language-server`, installed
  globally under nvm's Node, so it is on PATH only in a shell that sourced nvm. No headless mode;
  `npx tsc --noEmit` is the batch equivalent.
- After every edit, read the diagnostics block; a warning or error in a file you touched is part of
  the task: fix the code, or, when the diagnostic is wrong, fix what the server knows. Never silence
  one with `---@diagnostic disable`, `diagnostics.globals`, `// @ts-ignore`, `// @ts-expect-error` or
  `as any` without a comment citing the measured fact that makes it wrong (accepted exceptions: the
  `claude_diag.lua` warnings named under Tests).
- Hover a Resolve API method before calling it from Lua; hover or goToDefinition on the SDK's
  installed `.d.ts` before writing against it; findReferences and incomingCalls before changing an
  exported symbol; documentSymbol before reading a large file (`claude_diag.lua` is 1050 lines).
- The LSP never runs code: `fuscript`, `node --test`, `tsc --noEmit` and the grep gates remain the
  acceptance gates. Its answers are evidence about declared types, not about Resolve's behaviour; the
  measurements win. `Executable not found in $PATH` means the binary is missing:
  `brew install lua-language-server`, or `npm i -g typescript-language-server typescript` under nvm.

## Working here

- Multi-line commit messages: `git commit -q -F - <<'EOF' ... EOF`.
- macOS `date` has no `%N` and `awk` no `strftime`: use zsh `zmodload zsh/datetime; $EPOCHREALTIME`
  for sub-second stamps and `date -r <epoch> '+%H:%M:%S'` to format one.
- Decoding a payload from `Fusion.prefs`: keys are serialised in hash order, so match
  `\bRLBResp = "([^"]*)"` (the `Prev` variant of `RLBDiag` cannot match because the next character is
  `P`); the value is `<id>:<hex>`, and `echo <hex> | xxd -r -p` is the envelope JSON (`op`, `ok`,
  `ms`, `session`, `result`). Fusion writes strings with `\"`, `\\`, `\n` and raw tabs and UTF-8. To
  compare two prefs files, strip the `RLB` lines and leading whitespace, `sort`, then `diff`.
- Large reference sources go into the session scratchpad via `curl`, then grep the relevant lines.
- `.claude/settings.json` enables the `mcp-server-dev` plugin (its `build-mcpb` skill is the packaging
  reference and `build-mcp-server` the tool-design reference) and `lua-lsp`; the repo-local
  `create-readme` skill under `.claude/skills/` wrote the README.
- One-off live probes against the bridge: a scratch `.mjs` under `.out/` (git-ignored,
  bundle-ignored) that spawns `server/index.js` with `StdioClientTransport` and calls tools, as
  `scripts/smoke.mjs` does; a stat loop on `Fusion.prefs` around a call counts the bridge's saves.
  Never send mutating Lua to a real project.
