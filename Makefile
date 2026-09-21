# resolve-lua-bridge developer targets (docs/plan.md). Step 2 adds the Lua targets; Step 3 adds
# build/test-node, Step 4 bundle/install/dev-register, Step 5 smoke/stop. Node targets source nvm.
SHELL := /bin/zsh
FUSCRIPT := /Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript
NVM := . $$HOME/.nvm/nvm.sh >/dev/null 2>&1
OUT := $(CURDIR)/.out

.PHONY: test test-lua check-bridge lint-lua gen-types

test: test-lua

## Lua tests under fuscript (stub Resolve objects, never touches the app) plus the grep gates.
test-lua: check-bridge
	@mkdir -p "$(OUT)"
	@set -o pipefail; dir=$$(mktemp -d) && RLB_TEST_DIR="$$dir" "$(FUSCRIPT)" -l lua "$(CURDIR)/tests/lua/run_tests.lua" \
	  | grep -v -e '^DaVinci Resolve Script' -e '^Copyright' | tee "$(OUT)/lua-tests.log"; \
	  grep -q '^RLB_TESTS_RESULT: PASS' "$(OUT)/lua-tests.log"

check-bridge:
	@sh tests/lua/check_bridge.sh bridge/resolve_lua_bridge.lua

## Lua LSP check (bridge/ and tests/ must be clean; scripts/claude_diag.lua keeps its accepted
## warnings) and the generated types block must match the installed .pyi.
lint-lua:
	@mkdir -p "$(OUT)"
	@$(NVM) && node scripts/gen-types.mjs --check
	@rm -f "$(OUT)/luals-check.json"; lua-language-server --check "$(CURDIR)" --checklevel=Warning \
	  --check_format=json --check_out_path="$(OUT)/luals-check.json" >/dev/null 2>&1 || true
	@if [ -f "$(OUT)/luals-check.json" ] && grep -qE '"file://[^"]*/(bridge|tests)/' "$(OUT)/luals-check.json"; then \
	  echo "lint-lua: FAIL: diagnostics under bridge/ or tests/ (see $(OUT)/luals-check.json)"; exit 1; \
	else echo "lint-lua: OK"; fi

## Regenerate the API classes in types/resolve_host.d.lua from Blackmagic's .pyi and README.
gen-types:
	@$(NVM) && node scripts/gen-types.mjs
