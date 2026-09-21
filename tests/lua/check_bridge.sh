#!/bin/sh
# Grep gates for bridge/resolve_mcp_bridge.lua. Full-line
# comments are stripped before the forbidden-call checks (a header comment once tripped the
# os.exit check). The forbidden-call pattern is self-tested against a sample so a regex edit
# cannot silently stop matching. Run: sh tests/lua/check_bridge.sh [path]
set -u
F="${1:-bridge/resolve_mcp_bridge.lua}"
fail=0
bad() { printf 'check_bridge: FAIL: %s\n' "$*"; fail=1; }

[ -f "$F" ] || { bad "$F not found"; exit 1; }

# Each alternative is anchored at the start of the line or after a non-identifier character, so a
# call in column 0 is caught too; a leading "." excludes fields such as st.print or dbg.traceback.
PATTERN='(^|[^.[:alnum:]_])os\.(exit|execute|remove|rename)([^[:alnum:]_]|$)|(^|[^[:alnum:]_.])io\.|(^|[^[:alnum:]_.])require([^[:alnum:]_]|$)|fusion:Execute|RunScript|(^|[^[:alnum:]_.])debug\.|(^|[^[:alnum:]_.:])print\('
sample='os.exit()
require("x")
io.open("f")
debug.traceback(e)
print("x")
  os.execute("ls")
fusion:Execute("x")
fusion:RunScript("x")'
n=$(printf '%s\n' "$sample" | grep -cE "$PATTERN")
[ "$n" = 8 ] || bad "self-test: the forbidden-call pattern matched $n of 8 sample lines"
clean='  st.print = function(...)
  local dbg = gread("debug")
  rawset(_G, "print", cap.print)
  return version_ok'
n=$(printf '%s\n' "$clean" | grep -cE "$PATTERN")
[ "$n" = 0 ] || bad "self-test: the forbidden-call pattern matched $n allowed sample lines"

lines=$(wc -l < "$F" | tr -d ' ')
[ "$lines" -lt 600 ] || bad "$lines lines (limit 600)"

sed -n 1p "$F" | grep -Eq '^-- resolve_mcp_bridge v[0-9]+\.[0-9]+\.[0-9]+$' || bad "line 1 is not the version header"
[ "$(sed -n 2p "$F")" = "-- RLB_STATE_DIR=@@RLB_STATE_DIR@@" ] || bad "line 2 is not the state-dir stamp"
n=$(grep -c -F '[==[@@RLB_STATE_DIR@@]==]' "$F")
[ "$n" = 1 ] || bad "expected exactly 1 long-bracket state-dir stamp, found $n"
if grep -q -F '"@@RLB_STATE_DIR@@"' "$F"; then bad "the state-dir stamp must not be a quoted string literal"; fi

code=$(grep -v -E '^[[:space:]]*--' "$F")

hits=$(printf '%s\n' "$code" | grep -nE "$PATTERN" || true)
[ -z "$hits" ] || bad "forbidden call(s):
$hits"

count() { printf '%s\n' "$code" | grep -c "$1"; }
n=$(count ':SavePrefs('); [ "$n" = 1 ] || bad "expected exactly 1 SavePrefs call site, found $n"
n=$(count ':SetPrefs('); [ "$n" = 1 ] || bad "expected exactly 1 SetPrefs call site, found $n"
n=$(count ':GetPrefs('); [ "$n" = 1 ] || bad "expected exactly 1 GetPrefs call site (the stop guard), found $n"

if [ "$fail" = 0 ]; then
  printf 'check_bridge: OK (%s lines, headers, stamp, no forbidden calls, one SetPrefs/SavePrefs/GetPrefs)\n' "$lines"
fi
exit "$fail"
