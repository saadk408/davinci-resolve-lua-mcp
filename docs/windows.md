# Windows: what is assumed, what is measured, and how to measure it

Version 0.2.0 ships Windows support as experimental. The server computes Windows paths and the
same `.mcpb` installs on Windows, but no Windows machine was available while it was written:
nothing about DaVinci Resolve's Windows Lua host has been measured. macOS remains the reference
platform, and every measured fact in the project is a macOS fact. This page lists what the port
assumes, what a Windows contributor should confirm, the commands to do it with, and how to report.

## What the port assumes

| Item | Value assumed | Source |
|---|---|---|
| Per-user scripts folder (the two Lua files go here) | `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility` | Blackmagic's scripting README shipped with Resolve 21.1 (documented) |
| `Fusion.prefs` (the answer channel) | `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Profiles\Default\Fusion.prefs` | Forum reports, consistent with the README's `Support\Fusion` layout (not documented, not measured) |
| Scripting reference for `scripting_api_docs` | `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting` | Shipped README (documented) |
| State directory | `%USERPROFILE%\.davinci-resolve-lua-mcp`, stamped into the Lua files with forward slashes | Node's `os.homedir()`; LuaJIT's `loadfile` accepts `/` on Windows (documented) |
| Claude Desktop folders | `%APPDATA%\Claude\` (direct-download installer); `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\` (Microsoft Store) | Claude Desktop documentation and issue reports |
| `fuscript` (not used on Windows yet) | `C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe` | Shipped README (documented) |

## Before you start

- Windows 10 or 11, DaVinci Resolve 21.1 free edition, Claude Desktop. Note whether Claude Desktop
  came from the direct download or the Microsoft Store: their folders differ.
- A scratch project open in Resolve. `claude_diag` creates bins and a timeline in the open project,
  and the smoke steps below add and delete a timeline. Never use a real edit.
- PowerShell. Every snippet works in Windows PowerShell 5.1; nothing needs PowerShell 7 or an
  elevated prompt unless said so.

## Step 1: install and check the self-install

1. Install the `.mcpb` as the README describes. Keep the defaults.
2. Ask Claude for `resolve_status`. Save the whole answer. Record `platform`, `config.scripts_dir`,
   `config.prefs_dir`, `config.docs_dir`, `state_dir`, `state_dir_ascii`, `bridge_script.outcome`
   and `config_problems`.
3. Confirm the two files landed where Resolve looks:

   ```powershell
   Get-ChildItem "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility"
   ```

   Expected: `resolve_mcp_bridge.lua` and `claude_diag.lua`. If the folder does not exist, find the
   one Resolve made and record it (finding W2):

   ```powershell
   Get-ChildItem -Recurse -Directory -Filter Utility "$env:APPDATA\Blackmagic Design"
   ```

4. Confirm the stamp uses forward slashes and equals `state_dir` from `resolve_status`:

   ```powershell
   Select-String -LiteralPath "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\resolve_mcp_bridge.lua" -Pattern '^-- RLB_STATE_DIR='
   ```

5. In Resolve, open `Workspace > Scripts`: both scripts must be listed (W2).

## Step 2: launch the bridge and run the smoke equivalent

`make smoke` is a macOS script. This is the manual equivalent, in Claude Desktop, after
`Workspace > Scripts > resolve_mcp_bridge` with the scratch project open.

1. `resolve_status`: expect `alive: true`, `platform: "win32"` and `state_dir_match: true`. If
   `state_dir_match` is false, record `state_dir` and the session's `state_dir` (W3, W6).
2. `get_project_info`: the scratch project's name, frame rate and resolution.
3. `run_lua` returning a table (W3, W7):

   ```lua
   local project = resolve:GetProjectManager():GetCurrentProject()
   return { version = resolve:GetVersionString(), project = project:GetName(),
     timelines = project:GetTimelineCount(), home = os.getenv("HOME"),
     userprofile = os.getenv("USERPROFILE"), appdata = os.getenv("APPDATA") }
   ```

4. A marker on a scratch timeline. First `run_lua` with
   `return resolve:GetProjectManager():GetCurrentProject():GetMediaPool():CreateEmptyTimeline("bridge-smoke-win") ~= nil`,
   then `add_marker` (frame 0, colour Blue, name `win-smoke`), then `delete_markers` with
   `color: "Blue"` and `confirm: true`, then delete the timeline:

   ```lua
   local project = resolve:GetProjectManager():GetCurrentProject()
   for i = 1, project:GetTimelineCount() do
     local tl = project:GetTimelineByIndex(i)
     if tl:GetName() == "bridge-smoke-win" then return project:GetMediaPool():DeleteTimelines({ tl }) end
   end
   return "not found"
   ```

5. Ten `resolve_status` calls in a row; record the `ping_ms` values (about 60 ms on the measured
   Mac) (W10).
6. Search the server log for sharing errors (W11):

   ```powershell
   Select-String -LiteralPath "$env:USERPROFILE\.davinci-resolve-lua-mcp\server.log" -Pattern 'EBUSY|EPERM|retry'
   ```

7. Takeover (W8): click `Workspace > Scripts > resolve_mcp_bridge` a second time, then
   `resolve_status` twice. Expect a new session id and `alive: true` both times; the server log
   shows the session change and no error.
8. `capture_frame` with no arguments on the scratch timeline (W14): expect one image, and
   `page.restored` and `playhead.restored` true. Then list the state directory: no
   `capture-*.bmp` file may be left.

   ```powershell
   Get-ChildItem -LiteralPath "$env:USERPROFILE\.davinci-resolve-lua-mcp" -Filter 'capture-*.bmp'
   ```

9. `stop_bridge`: expect `ok`; then `resolve_status` reports `stopped`.

## Step 3: run claude_diag and decode RLBDiag

1. With the scratch project open, click `Workspace > Scripts > claude_diag`. It runs for about
   35 seconds (a 30-second loop), creates a `claude_diag` bin with one sub-bin per finding, and
   creates and deletes one timeline. Wait for the `RLB_DIAG_DONE` bin to appear.
2. Decode the result to a file on your Desktop:

   ```powershell
   $prefs = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Profiles\Default\Fusion.prefs'
   $hex = [regex]::Match((Get-Content -Raw -LiteralPath $prefs), 'RLBDiag = "([0-9a-fA-F]+)"').Groups[1].Value
   $bytes = [byte[]]::new($hex.Length / 2); for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring(2 * $i, 2), 16) }
   [Text.Encoding]::UTF8.GetString($bytes) | Set-Content -Encoding UTF8 -LiteralPath "$env:USERPROFILE\Desktop\claude_diag.json"
   ```

   The pattern `RLBDiag = "` (with the space, the equals sign and the quote) cannot match the
   previous run's `RLBDiagPrev`. If `$prefs` does not exist, that is finding W1: locate the file and
   use that path instead.

   ```powershell
   Get-ChildItem -Recurse -Filter Fusion.prefs "$env:APPDATA\Blackmagic Design"
   ```

3. The last tool answer decodes the same way; its value is `<id>:<hex>`:

   ```powershell
   $hex = ([regex]::Match((Get-Content -Raw -LiteralPath $prefs), 'RLBResp = "([^"]*)"').Groups[1].Value -split ':')[1]
   ```

   then the `$bytes` and `GetString` lines above.

## Facts to confirm

| # | Fact | How | Read it from | macOS value |
|---|---|---|---|---|
| W1 | `Fusion.prefs` path | Step 3.2 | `fusion.profile`, `fusion.prefs_path`, `fusion.prefs_exists` in `claude_diag.json` | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs` |
| W2 | The free edition scans the per-user `Support\Fusion\Scripts\Utility` folder | Steps 1.3 to 1.5 | `fusion.scripts_root`, `fusion.scripts_utility` | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility` |
| W3 | `bmd.fileexists` and `loadfile` accept the forward-slash state dir | Steps 2.1 and 2.3 succeed | `state_dir.candidates[].next_exists`, `state_dir.chosen`, `request.*`, `request.control_loadfile_self_slashes` | both true |
| W4 | `SavePrefs` writes a new file (rename) or in place; the server polls `{ino, size, mtimeMs}` and reads the file in full every 20 polls anyway | Run `fsutil file queryfileid "<prefs path>"` before and after one `resolve_status` call (an elevated prompt if it refuses); a different id per save means rename | | new inode every save, single-digit ms |
| W5 | Line endings of `Fusion.prefs` | `(Get-Content -Raw -LiteralPath $prefs) -match "`r`n"` | | LF |
| W6 | A non-ASCII `%USERPROFILE%` survives LuaJIT's ANSI `fopen` | Only on such an account: set the State directory setting to a path containing `é`, reinstall, relaunch the script, `resolve_status` | `env.HOME`, `env.USERPROFILE` (mojibake means the code page is not UTF-8); `state_dir_ascii` in `resolve_status` | n/a |
| W7 | The sandbox census | Step 3 | `env.types` (`io`, `os`, `require`, `package`, `ffi`, `debug`), `env.os_keys`, `env.bmd_keys`, `muted.print`, `muted.io_open` | nil: `io`, `os.execute/remove/rename`, `require`, `package`, `ffi`, `debug`; 28 `bmd.*` keys |
| W8 | A second click takes over cleanly | Step 2.7 | server log | measured live |
| W9 | The smoke equivalent passes | Step 2 | | `make smoke` |
| W10 | Round-trip latency | Step 2.5 | `ping_ms` | about 60 ms |
| W11 | Sharing errors on `next.lua` (`EBUSY`, `EPERM`) and whether the retry absorbs them | Step 2.6 | server log | none on macOS |
| W12 | Claude Desktop substitutes `${HOME}` on Windows | Step 1.2: `state_dir` is `C:/Users/<you>/.davinci-resolve-lua-mcp` and `config_problems` is empty | | passed through literally, expanded by the server |
| W13 | Claude Desktop's folders for your install kind | The next section | | `~/Library/Application Support/Claude/`, `~/Library/Logs/Claude/` |
| W14 | `ExportCurrentFrameAsStill` writes a BMP to a forward-slash path in the state directory, and the server can delete it afterwards | Step 2.8 | the result's `frames[]` and `failed[]`; the state directory listing | measured 2026-09-24 |

## Where the logs are

Direct-download install:

```powershell
Get-ChildItem "$env:APPDATA\Claude\logs" | Sort-Object LastWriteTime -Descending | Select-Object -First 10
Get-Content -Tail 50 -LiteralPath "$env:APPDATA\Claude\logs\mcp-server-DaVinci Resolve Lua MCP.log"
```

Microsoft Store install (the whole `%APPDATA%\Claude` tree is redirected):

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\logs"
```

The server's own log is `%USERPROFILE%\.davinci-resolve-lua-mcp\server.log` (the path is in
`resolve_status` under `config.log_file`). The installed extension is under
`%APPDATA%\Claude\Claude Extensions\local.mcpb.saad-khan.davinci-resolve-lua-mcp\` (Store: the same
under the `LocalCache\Roaming\Claude` path), and `extensions-installations.json` next to it records
`installedAt` and the bundle's SHA-256 as `hash`.

## Reporting

Open an issue titled `Windows measurement: Resolve <version>, Windows <version>, Claude Desktop <direct download | Microsoft Store>`
with: the `resolve_status` answers from Step 1.2 and Step 2.1, the W1 to W13 table filled in,
`claude_diag.json` (it contains paths with your user name; redact them if you prefer) and
`server.log`. Never attach `Fusion.prefs` itself: it holds Resolve's preferences and the last tool
answer. A measurement that contradicts an assumed value changes a default in the next release and
moves the line from "assumed" to "measured" in `CLAUDE.md`.

## Developing on Windows

The Makefile is a macOS tool (zsh, `fuscript`, `open`, nvm). From Git Bash in a checkout:

```sh
npm ci
bash tests/check_server.sh src
bash tests/lua/check_bridge.sh bridge/resolve_mcp_bridge.lua
npm run typecheck && npm run build
node --import tsx --test tests/*.test.ts   # not `npm test`: npm runs scripts under cmd.exe, which does not expand the glob
npm run bundle                             # mcpb validate + pack + info, then tests/check_bundle.mjs
```

The `fuscript`-backed tests skip themselves (they look for the macOS `fuscript`). `make test-lua`,
`make smoke` and `make dev-register` have no Windows equivalent. For a developer loop, add this
entry to `claude_desktop_config.json` (`%APPDATA%\Claude\`, or the `LocalCache\Roaming\Claude` path
for a Store install) by hand and restart Claude Desktop; it is also the only way to set
`RLB_DOCS_DIR`, `RLB_MAX_RESPONSE_KB` or `RLB_LOG_LEVEL`, which the extension's settings do not
expose:

```json
"davinci-resolve-lua-mcp-dev": {
  "command": "node",
  "args": ["C:\\path\\to\\checkout\\server\\index.js"],
  "env": { "RLB_LOG_LEVEL": "debug", "RLB_DOCS_DIR": "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting" }
}
```
