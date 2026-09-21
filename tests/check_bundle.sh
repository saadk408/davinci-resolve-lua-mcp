#!/bin/sh
# Gate for the packed bundle (docs/plan.md Step 4): the archive holds exactly the shipped files,
# stays under 2 MB, and the unpacked copy answers tools/list with the 15 tools over stdio (under a
# temp state dir, with the self-install off, so nothing outside the temp dir is touched).
# Run: sh tests/check_bundle.sh dist/davinci-resolve-lua-mcp.mcpb
set -u
B="${1:-dist/davinci-resolve-lua-mcp.mcpb}"
fail=0
bad() { printf 'check_bundle: FAIL: %s\n' "$*"; fail=1; }

[ -f "$B" ] || { bad "$B not found (make bundle)"; exit 1; }

REQUIRED="manifest.json package.json server/index.js bridge/resolve_mcp_bridge.lua scripts/claude_diag.lua icon.png"
OPTIONAL="README.md LICENSE"

# 1. File list: mcpb's zip has no directory entries, so this is exactly the file set.
list=$(zipinfo -1 "$B") || { bad "zipinfo cannot read $B"; exit 1; }
for f in $REQUIRED; do
  echo "$list" | grep -qx "$f" || bad "missing $f"
done
for f in $list; do
  case " $REQUIRED $OPTIONAL " in
    *" $f "*) ;;
    *) bad "unexpected file in the bundle: $f (add it to .mcpbignore)";;
  esac
done

# 2. Size.
size=$(stat -f %z "$B")
[ "$size" -lt 2097152 ] || bad "bundle is $size bytes, the limit is 2 MB"

# 3. Unpack and probe: initialize, initialized, tools/list over stdio.
tmp=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$tmp"' EXIT
unzip -q "$B" -d "$tmp/bundle" || bad "unzip failed"
mkdir -p "$tmp/state"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check_bundle","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | RLB_STATE_DIR="$tmp/state" RLB_AUTO_INSTALL=false RLB_LOG_LEVEL=warn node "$tmp/bundle/server/index.js" >"$tmp/stdout.txt" 2>"$tmp/stderr.txt"
rc=$?
[ "$rc" -eq 0 ] || bad "the unpacked server exited $rc (see stderr below)"
tools=$(node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
  const reply = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === 2);
  if (!reply || !reply.result || !Array.isArray(reply.result.tools)) { console.log("NO_REPLY"); process.exit(0); }
  console.log(reply.result.tools.map((t) => t.name).sort().join(" "));
' "$tmp/stdout.txt")
count=$(echo "$tools" | wc -w | tr -d ' ')
if [ "$tools" = "NO_REPLY" ]; then bad "no tools/list reply from the unpacked server"; fi
[ "$count" -eq 15 ] || bad "expected 15 tools, got $count: $tools"
echo "$tools" | grep -q 'resolve_status' || bad "resolve_status missing from tools/list"
[ -e "$tmp/state/lock" ] && bad "the unpacked server left its lock file behind"
if [ "$fail" -ne 0 ] && [ -s "$tmp/stderr.txt" ]; then sed 's/^/  stderr: /' "$tmp/stderr.txt"; fi

if [ "$fail" -eq 0 ]; then echo "check_bundle: OK ($count tools, $size bytes, $(echo "$list" | wc -l | tr -d ' ') files)"; fi
exit "$fail"
