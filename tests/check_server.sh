#!/bin/sh
# Grep gates for src/ (docs/plan.md Step 3, "Project-specific rules"): stdout is the MCP
# transport, so console.log never appears; the server never spawns a process and never opens a
# network listener. Full-line comments are stripped first. Run: sh tests/check_server.sh [dir]
set -u
D="${1:-src}"
fail=0
bad() { printf 'check_server: FAIL: %s\n' "$*"; fail=1; }

[ -d "$D" ] || { bad "$D not found"; exit 1; }

strip() { grep -v -E '^[[:space:]]*(//|\*)' "$1"; }

for f in "$D"/*.ts; do
  if strip "$f" | grep -q -E '(^|[^[:alnum:]_.])console\.log\('; then bad "$f calls console.log"; fi
  if strip "$f" | grep -q -E 'process\.stdout'; then bad "$f touches process.stdout"; fi
  if strip "$f" | grep -q -E "from '(node:)?child_process'|require\(['\"](node:)?child_process"; then bad "$f imports child_process"; fi
  if strip "$f" | grep -q -E "from '(node:)?(http|https|net|dgram|http2|tls)'"; then bad "$f imports a network module"; fi
  if strip "$f" | grep -q -E '\.listen\('; then bad "$f opens a listener"; fi
done

# Every value embedded in Lua goes through luaString/luaInt/luaBool/luaStringList: no template
# hole may sit inside a Lua quoted string in lua.ts.
if strip "$D/lua.ts" | grep -q -E '"[^"]*\$\{[^}]*\}[^"]*"' ; then bad "lua.ts embeds a raw value inside a quoted Lua string"; fi

# The private instrumented build (docs/plan.md Step 8) lives in another repository: its vendor name
# must never appear in the public sources, package.json or manifest.json (comments included).
if grep -qil sentry "$D"/*.ts "$D/../package.json" "$D/../manifest.json"; then bad "the word sentry appears in $D, package.json or manifest.json (the private build's code must not enter this repository)"; fi

if [ "$fail" -eq 0 ]; then echo "check_server: OK"; fi
exit "$fail"
