#!/bin/sh
set -eu

repo=$(cd "${1:-$(dirname "$0")/..}" && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
target="${AGENT_OFFICE_APP:-/Applications/Agent Office.app}"
ref="${AGENT_OFFICE_REF:-origin/main}"
window_app="$target/Contents/MacOS/Agent Office"
cache="$HOME/Library/Caches/agent-office"
log_dir="$HOME/Library/Logs/agent-office"
log="$log_dir/install-app.log"
lockdir="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)/agent-office-install.lock"
worktree=""

mkdir -p "$cache" "$log_dir"
mkdir "$lockdir" 2>/dev/null || { echo "An install is already running. Log: $log" >&2; exit 1; }
trap 'if [ -n "$worktree" ]; then git -C "$repo" worktree remove --force "$worktree" >/dev/null 2>&1 || true; rm -rf "$worktree"; fi; rm -rf "$lockdir"' EXIT

exec > "$log" 2>&1
running() { ps -axo command= | grep -Fxq "$window_app"; }
step() { echo "$(date '+%H:%M:%S') $1"; }
fail() {
  step "failed: $1"
  osascript -e "display notification \"Log: $log\" with title \"Agent Office\" subtitle \"Update failed: $1\"" >/dev/null 2>&1 || true
  exit 1
}

step "fetching origin/main in $repo"
git -C "$repo" fetch --quiet origin main || fail "fetch"
commit=$(git -C "$repo" rev-parse "$ref^{commit}") || fail "no commit $ref"

worktree=$(mktemp -d "${TMPDIR:-/tmp}/agent-office-install-XXXXXX")
rmdir "$worktree"
git -C "$repo" worktree add --quiet --detach "$worktree" "$commit" || fail "worktree"

step "installing dependencies for $(git -C "$repo" log -1 --format='%h %s' "$commit")"
(cd "$worktree" && pnpm install --frozen-lockfile --prefer-offline) || fail "pnpm install"

step "building"
[ -n "${CSC_NAME:-}" ] || export CSC_IDENTITY_AUTO_DISCOVERY=false
(cd "$worktree" && AGENT_OFFICE_COMMIT="$commit" AGENT_OFFICE_REPO="$repo" pnpm build && pnpm exec electron-builder --mac --dir) || fail "build"
built=$(find "$worktree/dist" -maxdepth 2 -name 'Agent Office.app' -type d | head -1)
[ -n "$built" ] || fail "no app in dist"

step "installing to $target"
staged="$target.new"
rm -rf "$staged"
ditto "$built" "$staged" || fail "copy"

if running; then
  step "quitting the window app; agents keep running in the host"
  osascript -e 'tell application "Agent Office" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 60); do running || break; sleep 0.5; done
  running && { rm -rf "$staged"; fail "the window app didn't quit"; }
fi

rm -rf "$cache/Agent Office.previous.app"
[ -d "$target" ] && mv "$target" "$cache/Agent Office.previous.app"
mv "$staged" "$target"
step "installed $(git -C "$repo" rev-parse --short "$commit"); opening"
open "$target"
