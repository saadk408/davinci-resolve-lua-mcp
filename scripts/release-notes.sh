#!/usr/bin/env bash
# Release notes for the GitHub Release of tag $TAG, on stdout: the annotated tag's message (subject
# and body; a signature block is left out) when the tag object is annotated, else one default line;
# then the fixed Install, Requirements and Signing sections; then the SHA-256 of the bundle. On a
# lightweight tag %(contents) would print the commit message, hence the object-type test.
# Developer-only (in .mcpbignore); .github/workflows/release.yml runs it on a tag push.
# Local dry run: make bundle && TAG=v0.1.0 bash scripts/release-notes.sh dist/davinci-resolve-lua-mcp.mcpb
set -euo pipefail
TAG="${TAG:?set TAG=vX.Y.Z}"
BUNDLE="${1:?usage: TAG=vX.Y.Z release-notes.sh <bundle>}"
[ -f "$BUNDLE" ] || { echo "release-notes: $BUNDLE not found (make bundle)" >&2; exit 1; }

# actions/checkout v6.0.2+ fetches the tag ref as itself, so this is a no-op there; it restores the
# tag object after an older checkout. Never on a developer Mac (offline, and a shallow clone).
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  git fetch --force --no-tags origin "refs/tags/$TAG:refs/tags/$TAG"
fi

case "$(git cat-file -t "refs/tags/$TAG")" in
  tag)    intro="$(git tag -l --format='%(contents:subject)%0a%0a%(contents:body)' "$TAG")" ;;
  commit) intro="$TAG of DaVinci Resolve Lua MCP." ;;
  *)      echo "release-notes: refs/tags/$TAG is neither a tag nor a commit" >&2; exit 1 ;;
esac
name="$(basename "$BUNDLE")"
sha="$(shasum -a 256 "$BUNDLE" | cut -d' ' -f1)"

printf '%s\n\n' "$intro"
cat <<'EOF'
## Install

1. Download `davinci-resolve-lua-mcp.mcpb` below and open it, or drag it onto the Claude Desktop window. Keep the default settings and click **Install**.
2. In Resolve, open a project and click `Workspace > Scripts > resolve_mcp_bridge`. The extension put that script there when it first started. Click it again after every Resolve launch.
3. Ask Claude "Are you connected to DaVinci Resolve?".

The [README](https://github.com/saadk408/davinci-resolve-lua-mcp#readme) has the tool table, the settings, troubleshooting and the security notes.

## Requirements

macOS, or Windows 10 or 11 (experimental, see below). DaVinci Resolve 21.1 free edition (build 21.1.0.17 on macOS is the only one this release was measured against). Claude Desktop.

## Windows (experimental)

The Windows paths follow Blackmagic's documented layout and were not measured on a Windows machine. If you run this on Windows, please open an issue titled "Windows measurement: Resolve <version>, Windows <version>, Claude Desktop <direct download or Microsoft Store>" with the `resolve_status` answer and the filled-in checklist from [docs/windows.md](https://github.com/saadk408/davinci-resolve-lua-mcp/blob/main/docs/windows.md); the decoded `claude_diag` output is the most useful attachment. A measurement that contradicts an assumed path changes the default in the next release.

## Signing

This bundle is not code-signed. Claude Desktop installs it as an unsigned extension; an organisation policy that blocks unsigned extensions will refuse it. A signed build will replace it once the maintainer's certificate is issued.

EOF
printf '## Checksum\n\nSHA-256 of `%s`: `%s`\n' "$name" "$sha"
