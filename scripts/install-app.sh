#!/bin/sh
set -eu

repo=$(cd "${1:-$(dirname "$0")/..}" && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
target="${AGENT_OFFICE_APP:-/Applications/Agent Office.app}"
ref="${AGENT_OFFICE_REF:-origin/main}"
only="${AGENT_OFFICE_STEP:-all}"
window_app="$target/Contents/MacOS/Agent Office"
cache="$HOME/Library/Caches/agent-office"
staged="$cache/Agent Office.new.app"
log_dir="$HOME/Library/Logs/agent-office"
log="$log_dir/install-app.log"
lockdir="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)/agent-office-install.lock"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
worktree=""

mkdir -p "$cache" "$log_dir"
mkdir "$lockdir" 2>/dev/null || { echo "An install is already running. Log: $log" >&2; exit 1; }
trap 'if [ -n "$worktree" ]; then git -C "$repo" worktree remove --force "$worktree" >/dev/null 2>&1 || true; rm -rf "$worktree"; fi; rm -rf "$lockdir"' EXIT

if [ "$only" = swap ]; then exec >> "$log" 2>&1; else exec > "$log" 2>&1; fi
window_pids() { ps -axo pid=,command= | awk -v app="$window_app" '{ pid = $1; sub(/^ *[0-9]+ +/, "") } $0 == app { print pid }'; }
running() { [ -n "$(window_pids)" ]; }
step() { echo "$(date '+%H:%M:%S') $1"; }
fail() {
  step "failed: $1"
  osascript -e "display notification \"Log: $log\" with title \"Agent Office\" subtitle \"Update failed: $1\"" >/dev/null 2>&1 || true
  exit 1
}

build() {
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

  rm -rf "$staged"
  ditto "$built" "$staged" || fail "copy"
  step "staged $(git -C "$repo" rev-parse --short "$commit")"
}

swap() {
  [ -d "$staged" ] || fail "nothing staged to install"
  step "installing to $target"
  if running; then
    step "quitting the window app"
    kill $(window_pids) 2>/dev/null || true
    for _ in $(seq 60); do running || break; sleep 0.5; done
    running && fail "the window app didn't quit"
  fi
  if [ -d "$target" ]; then
    rm -rf "$cache/Agent Office.previous.app"
    mv "$target" "$cache/Agent Office.previous.app"
  fi
  mv "$staged" "$target"
  touch "$target"
  "$lsregister" -u "$cache/Agent Office.previous.app" >/dev/null 2>&1 || true
  "$lsregister" -f "$target" >/dev/null 2>&1 || true
  step "installed; opening"
  open -n "$target" --args --restart-host
}

case "$only" in
  build) build ;;
  swap) swap ;;
  all) build && swap ;;
  *) fail "unknown AGENT_OFFICE_STEP $only" ;;
esac
