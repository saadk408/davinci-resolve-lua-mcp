# resolve-lua-bridge developer targets (docs/plan.md). Step 2 added the Lua targets, Step 3 the
# Node targets (build, test-node, check-server, inspect); Step 4 adds bundle/install/dev-register,
# Step 5 smoke/stop. Node targets source nvm themselves.
SHELL := /bin/zsh
FUSCRIPT := /Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript
NVM := . $$HOME/.nvm/nvm.sh >/dev/null 2>&1
OUT := $(CURDIR)/.out

.PHONY: test test-lua test-node check-bridge check-server lint-lua gen-types typecheck build inspect clean

test: test-lua test-node

## Lua tests under fuscript (stub Resolve objects, never touches the app) plus the grep gates.
## fuscript exits 0 whatever the script does, so the RLB_TESTS_RESULT marker line is the gate.
test-lua: check-bridge
	@mkdir -p "$(OUT)"
	@set -o pipefail; dir=$$(mktemp -d) && RLB_TEST_DIR="$$dir" "$(FUSCRIPT)" -l lua "$(CURDIR)/tests/lua/run_tests.lua" \
	  | grep -v -e '^DaVinci Resolve Script' -e '^Copyright' | tee "$(OUT)/lua-tests.log"; \
	  grep -q '^RLB_TESTS_RESULT: PASS' "$(OUT)/lua-tests.log"

check-bridge:
	@sh tests/lua/check_bridge.sh bridge/resolve_lua_bridge.lua

## Node tests (node --test through tsx, in temp directories; the two fuscript-backed tests skip
## themselves when Resolve is not installed) after the src/ grep gates and the type check.
test-node: check-server typecheck
	@$(NVM) && npm test

check-server:
	@sh tests/check_server.sh src

typecheck:
	@$(NVM) && npm run typecheck

## tsc --noEmit, then esbuild bundles src/index.ts (+ SDK + zod) into server/index.js (cjs, node20).
build:
	@$(NVM) && npm run build
	@ls -la server/index.js

## Ask the built server for its tool list through the MCP Inspector in CLI mode.
inspect: build
	@$(NVM) && npx --yes @modelcontextprotocol/inspector --cli node server/index.js -- --method tools/list

## Lua LSP check (bridge/ and tests/ must be clean; scripts/claude_diag.lua keeps its accepted
## warnings) and the generated types block must match the installed .pyi. lua-language-server
## exits 0 when the workspace is clean, 1 when any diagnostic exists (then the JSON report is
## inspected), and anything else is a failure (127 = not on PATH: brew install lua-language-server).
lint-lua:
	@mkdir -p "$(OUT)"
	@$(NVM) && node scripts/gen-types.mjs --check
	@rm -f "$(OUT)/luals-check.json"; lua-language-server --check "$(CURDIR)" --checklevel=Warning \
	  --check_format=json --check_out_path="$(OUT)/luals-check.json" >"$(OUT)/luals-check.log" 2>&1; rc=$$?; \
	  if [ $$rc -eq 0 ]; then echo "lint-lua: OK (no diagnostics)"; \
	  elif [ $$rc -eq 1 ] && [ -f "$(OUT)/luals-check.json" ]; then \
	    if grep -qE '"file://[^"]*/(bridge|tests)/' "$(OUT)/luals-check.json"; then \
	      echo "lint-lua: FAIL: diagnostics under bridge/ or tests/ (see $(OUT)/luals-check.json)"; exit 1; \
	    else echo "lint-lua: OK (only the accepted diagnostics outside bridge/ and tests/)"; fi; \
	  else echo "lint-lua: FAIL: lua-language-server exited $$rc (see $(OUT)/luals-check.log)"; exit 1; fi

## Regenerate the API classes in types/resolve_host.d.lua from Blackmagic's .pyi and README.
gen-types:
	@$(NVM) && node scripts/gen-types.mjs

clean:
	@rm -rf server dist "$(OUT)"
