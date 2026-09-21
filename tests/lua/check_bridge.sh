#!/bin/sh
# Grep gates for bridge/resolve_lua_bridge.lua (docs/plan.md Step 2 acceptance). Full-line
# comments are stripped before the forbidden-call checks (a header comment once tripped the
# os.exit check). Run: sh tests/lua/check_bridge.sh [path]
set -u
F="${1:-bridge/resolve_lua_bridge.lua}"
fail=0
bad() { printf 'check_bridge: FAIL: %s\n' "$*"; fail=1; }

[ -f "$F" ] || { bad "$F not found"; exit 1; }

lines=$(wc -l < "$F" | tr -d ' ')
[ "$lines" -lt 600 ] || bad "$lines lines (limit 600)"

sed -n 1p "$F" | grep -Eq '^-- resolve_lua_bridge v[0-9]+\.[0-9]+\.[0-9]+$' || bad "line 1 is not the version header"
[ "$(sed -n 2p "$F")" = "-- RLB_STATE_DIR=@@RLB_STATE_DIR@@" ] || bad "line 2 is not the state-dir stamp"

code=$(grep -v -E '^[[:space:]]*--' "$F")

hits=$(printf '%s\n' "$code" | grep -nE '[^.[:alnum:]_]os\.(exit|execute|remove|rename)[^[:alnum:]_]|[^[:alnum:]_.]io\.|[^[:alnum:]_.]require[^[:alnum:]_]|fusion:Execute|RunScript|[^[:alnum:]_.]debug\.|[^[:alnum:]_.:]print\(' || true)
[ -z "$hits" ] || bad "forbidden call(s):
$hits"

count() { printf '%s\n' "$code" | grep -c "$1"; }
n=$(count ':SavePrefs('); [ "$n" = 1 ] || bad "expected exactly 1 SavePrefs call site, found $n"
n=$(count ':SetPrefs('); [ "$n" = 1 ] || bad "expected exactly 1 SetPrefs call site, found $n"
n=$(count ':GetPrefs('); [ "$n" = 1 ] || bad "expected exactly 1 GetPrefs call site (the stop guard), found $n"

if [ "$fail" = 0 ]; then
  printf 'check_bridge: OK (%s lines, headers, no forbidden calls, one SetPrefs/SavePrefs/GetPrefs)\n' "$lines"
fi
exit "$fail"
