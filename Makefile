# davinci-resolve-lua-mcp developer targets: the Lua targets (test-lua, check-bridge, lint-lua,
# gen-types), the Node targets (build, test-node, check-server, typecheck, inspect), the bundle and
# developer-loop targets (bundle, install, sign, dev-register, dev-unregister, uninstall-bridge) and
# the live targets (smoke, stop). Node targets source nvm when it is installed and CI is not set;
# under CI (GitHub sets CI=true) they use the Node already on PATH.
SHELL := /bin/zsh
FUSCRIPT := /Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript
NVM := { [ -z "$$CI" ] && [ -s $$HOME/.nvm/nvm.sh ] && . $$HOME/.nvm/nvm.sh >/dev/null 2>&1; } || true
OUT := $(CURDIR)/.out
MCPB := ./node_modules/.bin/mcpb
BUNDLE := dist/davinci-resolve-lua-mcp.mcpb
# The user Utility folder the server installs into; RLB_SCRIPTS_DIR overrides it (uninstall-bridge).
SCRIPTS_DIR = $(if $(RLB_SCRIPTS_DIR),$(RLB_SCRIPTS_DIR),$(HOME)/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility)

.PHONY: test test-lua test-node check-bridge check-server lint-lua gen-types typecheck build inspect clean \
        bundle install sign dev-register dev-unregister uninstall-bridge smoke stop

test: test-lua test-node

## Lua tests under fuscript (stub Resolve objects, never touches the app) plus the grep gates.
## fuscript exits 0 whatever the script does, so the RLB_TESTS_RESULT marker line is the gate.
test-lua: check-bridge
	@mkdir -p "$(OUT)"
	@set -o pipefail; dir=$$(mktemp -d) && RLB_TEST_DIR="$$dir" "$(FUSCRIPT)" -l lua "$(CURDIR)/tests/lua/run_tests.lua" \
	  | grep -v -e '^DaVinci Resolve Script' -e '^Copyright' | tee "$(OUT)/lua-tests.log"; \
	  grep -q '^RLB_TESTS_RESULT: PASS' "$(OUT)/lua-tests.log"

check-bridge:
	@sh tests/lua/check_bridge.sh bridge/resolve_mcp_bridge.lua

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

## Validate the manifest and the icon (mcpb validate on the directory), pack the bundle (what .mcpbignore leaves in), print it, then gate it with
## tests/check_bundle.sh (exact file list, size under 2 MB, unpack + tools/list probe under a temp
## state dir with the self-install off). Packs differ byte-wise (zip mtime); compare `zipinfo -1`.
bundle: build
	@mkdir -p dist
	@$(NVM) && $(MCPB) validate . && $(MCPB) pack . $(BUNDLE) && $(MCPB) info $(BUNDLE)
	@$(NVM) && sh tests/check_bundle.sh $(BUNDLE)

## Open the bundle so Claude Desktop shows its install dialog; the click is the user's (Step 5).
install: bundle
	@open $(BUNDLE)

## Optional self-signed signature for development (writes cert.pem and key.pem here, git-ignored).
sign: bundle
	@$(NVM) && $(MCPB) sign --self-signed $(BUNDLE) && $(MCPB) verify $(BUNDLE)

## Developer loop: merge a claude_desktop_config.json entry that runs this checkout's
## server/index.js with the current Node (backup first, other entries kept, mode 0600); a code
## change then needs `make build` and a Claude Desktop restart, not a repack. Never run by the tests.
dev-register: build
	@$(NVM) && node scripts/dev-register.mjs

dev-unregister:
	@$(NVM) && node scripts/dev-register.mjs --remove

## Remove the two Lua files the server installed, and nothing else, from the user Utility folder
## (or from RLB_SCRIPTS_DIR when set).
uninstall-bridge:
	@for f in resolve_mcp_bridge.lua claude_diag.lua; do \
	  p="$(SCRIPTS_DIR)/$$f"; \
	  if [ -f "$$p" ]; then rm -f "$$p" && echo "removed $$p"; else echo "not present: $$p"; fi; \
	done

## End-to-end smoke test against live Resolve with the bridge running: spawns the
## built server/index.js over stdio, as Claude Desktop does, and drives the tools. It creates and deletes
## a timeline named bridge-smoke and changes the project's render TargetDir/CustomName, so SMOKE_PROJECT
## must name the open scratch project. The request-slot lock must be free: once the extension is
## installed, disable it in Claude Desktop (or quit Claude Desktop) first. Log: .out/smoke.log, server
## stderr: .out/smoke-server.log. Extra flags via SMOKE_FLAGS (--no-render, --timeout <s>).
smoke: build
	@mkdir -p "$(OUT)"
	@set -o pipefail; $(NVM) && node scripts/smoke.mjs --project "$(SMOKE_PROJECT)" $(SMOKE_FLAGS) 2>&1 | tee "$(OUT)/smoke.log"

## Ask the running bridge loop to exit (stop_bridge through the built server); relaunch it from
## Workspace > Scripts afterwards.
stop: build
	@$(NVM) && node scripts/smoke.mjs --stop

clean:
	@rm -rf server dist "$(OUT)"
