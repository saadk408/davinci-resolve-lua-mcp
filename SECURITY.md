# Security

## Reporting a vulnerability

Report it privately through this repository's **Security** tab ("Report a vulnerability"), which opens an advisory only the maintainer can read. Please do not open a public issue for a security problem. This is a one-person project maintained in spare time; you will get an answer, but not always a fast one.

Only the latest release is supported. A fix ships as a new `.mcpb` ([latest download](https://github.com/saadk408/davinci-resolve-lua-mcp/releases/latest/download/davinci-resolve-lua-mcp.mcpb); the notes are on the Releases page); extensions installed from a file do not update on their own, so reinstall to get it.

## What counts

The README's Security section describes the design and its known limits. Reports that matter most:

- A way for a process other than the MCP server to get Lua executed inside Resolve, beyond the documented fact that anyone who can write to the state directory already can.
- A tool input that reaches a Lua chunk without passing through the escaping helper (a Lua injection).
- The server writing anywhere other than its state directory and Resolve's user Utility scripts folder, or opening a network listener of any kind.
- A way to make the bridge write Fusion preferences while idle, or to corrupt `Fusion.prefs`.

Out of scope: `run_lua` doing what Claude was asked to do, and the last response being readable in `Fusion.prefs` by other local accounts. Both are documented behaviour.
