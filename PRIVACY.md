# Privacy Policy

Effective 2026-09-21. This policy covers the DaVinci Resolve Lua MCP extension: the `.mcpb` bundle, the MCP server inside it, and the two Lua scripts it installs into DaVinci Resolve's user scripts folder.

## Summary

- Everything runs on your computer. The server talks to Claude Desktop over standard input and output only. It opens no network connection: the project's code contains no HTTP, socket or listener code, and a test gate (`tests/check_server.sh`, `tests/lua/check_bridge.sh`) fails the build if any is added.
- No telemetry, analytics, crash reporting or usage statistics. The developer receives nothing from your installation.
- No accounts and no credentials. The five settings are three folder paths, an on/off switch and a timeout.

## What the extension processes and where it is stored

Tool calls from Claude carry inputs: Lua code for `run_lua`, marker text, timeline and project names, output paths. Resolve answers with data about the open project: project, timeline, clip and marker metadata, media file paths, render settings. All of it stays in these places on your computer:

- **The request file** `next.lua` in the state directory (default `~/.davinci-resolve-lua-mcp` on macOS and `%USERPROFILE%\.davinci-resolve-lua-mcp` on Windows; created with mode 0700 on macOS, with your profile folder's permissions on Windows). It holds one request, including the full Lua chunk, and the server deletes it as soon as the answer arrives, also after a timeout.
- **The last answer** in Resolve's preferences file `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles/Default/Fusion.prefs` (Windows: `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Profiles\Default\Fusion.prefs`), under the key `Global.ResolveLuaBridge.RLBResp`, hex-encoded and not encrypted. It is the complete result of the most recent tool call and stays until the next call or the next bridge launch overwrites it. A session record (`RLBSession`: session id, Resolve's process id, product and version, the state directory path) sits next to it. On the measured Mac that file has mode 0666, so other local accounts can read it; on Windows it inherits `%APPDATA%`'s permissions, which by default keep other standard accounts out (not measured). A clean stop replaces the answer with the stop acknowledgement.
- **The server log** `server.log` in the state directory: timestamps, request and session ids, operation names (`ping`, `run`, `stop`), byte counts, durations, process ids, file paths (which include your home folder), version strings and error messages. A failing tool's error message can quote text from Resolve or Lua, such as a project name. The log never records tool names, tool arguments, Lua code or results. It is emptied when it passes 5 MB.
- **Claude Desktop's copy** of the server's standard error, the same log lines, at `~/Library/Logs/Claude/mcp-server-DaVinci Resolve Lua MCP.log` (Windows: `%APPDATA%\Claude\logs\`; a Microsoft Store install keeps it under `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\logs\`), kept under Claude Desktop's own rules.
- **The two scripts** `resolve_mcp_bridge.lua` and `claude_diag.lua`, copied into Resolve's user scripts folder, which carry the state directory path.

## What leaves your computer

Nothing, from the extension. Claude Desktop sends tool inputs and results to Anthropic as part of your conversation, as it does for any tool; [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) governs that. The download itself comes from GitHub, under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Third parties

The extension shares nothing with anyone. Anthropic (through Claude Desktop) and GitHub (the download) are the only third parties involved, each under its own policy. Blackmagic Design's software stores the preferences file described above; the extension sends nothing to Blackmagic Design.

## Retention and deletion

- The request file: one call.
- The last answer and the session record in `Fusion.prefs`: until overwritten; under 2 KB after a clean stop. Remove the `Global.ResolveLuaBridge.*` keys to clear them.
- The server log: until you delete it or it passes 5 MB.
- Everything else: until you follow the Uninstall steps in the [README](https://github.com/saadk408/davinci-resolve-lua-mcp#uninstall): remove the extension, delete the two scripts, delete the state directory.

## Your controls

- The install-time settings: the state directory, the scripts folder, the Fusion prefs folder, automatic script install (off means you copy the two files yourself) and the default timeout.
- `RLB_LOG_LEVEL` (see the README's settings) sets how much the server log records.
- `stop_bridge` ends the session; the last answer becomes the stop acknowledgement.
- Read every `run_lua` chunk before approving it. Claude Desktop asks for permission before running tools marked destructive, `run_lua` among them.

## Contact

Questions about this policy: [open an issue](https://github.com/saadk408/davinci-resolve-lua-mcp/issues). Security problems: the repository's Security tab ("Report a vulnerability"), as [SECURITY.md](https://github.com/saadk408/davinci-resolve-lua-mcp/blob/main/SECURITY.md) describes, never a public issue.

## Changes

This policy lives in the repository, and its git history is the record of changes. The extension's manifest links this file on the `main` branch.
