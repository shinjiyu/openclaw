#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Configuration — edit these to match your server setup
# ============================================================
SSH_HOST="kuroneko"                    # ~/.ssh/config Host name
REMOTE_DIR="/root/openclaw-fork"       # git clone on the server
SERVICE_NAME="openclaw-gateway"        # systemd service unit
REMOTE_BRANCH="main"                   # branch to pull
LOCAL_PUSH_REMOTE="fork"              # local git remote to push (fork, not upstream origin)
# ============================================================

SKIP_PUSH=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-local.sh [OPTIONS]

Deploy the current branch to a remote server via SSH.

Options:
  --skip-push   Skip local git push (assumes already pushed)
  --dry-run     Print commands without executing
  -h, --help    Show this help

Prerequisites:
  - SSH key auth configured in ~/.ssh/config for the target host
  - Remote dir is a git clone with the same remote as local
  - systemd service manages the gateway process
USAGE
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --skip-push) SKIP_PUSH=1 ;;
    --dry-run)   DRY_RUN=1 ;;
    -h|--help)   usage ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m OK: %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '\033[0;33m[dry-run] %s\033[0m\n' "$*"
    return 0
  fi
  "$@"
}

# ── Step 1: Local push ──────────────────────────────────────
if [ "$SKIP_PUSH" -eq 0 ]; then
  log "Pushing local branch to ${LOCAL_PUSH_REMOTE}..."
  run git push "${LOCAL_PUSH_REMOTE}" HEAD
else
  log "Skipping local push (--skip-push)"
fi

LOCAL_SHA="$(git rev-parse --short HEAD)"
log "Local HEAD: ${LOCAL_SHA}"

# ── Step 2: Remote deploy (single SSH connection) ───────────
log "Connecting to ${SSH_HOST}..."

REMOTE_SCRIPT=$(cat <<'REMOTE_EOF'
set -euo pipefail

REMOTE_DIR="__REMOTE_DIR__"
SERVICE_NAME="__SERVICE_NAME__"
REMOTE_BRANCH="__REMOTE_BRANCH__"

log()  { printf '\033[1;34m  [remote] %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  [remote] OK: %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  [remote] FAIL: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$REMOTE_DIR" || fail "Directory not found: $REMOTE_DIR"

# Check current state
OLD_SHA="$(git rev-parse --short HEAD)"
log "Current HEAD: ${OLD_SHA}"

git fetch origin "$REMOTE_BRANCH" --quiet

LOCAL_COUNT="$(git rev-list --count "origin/${REMOTE_BRANCH}..HEAD" 2>/dev/null || echo 0)"
BEHIND_COUNT="$(git rev-list --count "HEAD..origin/${REMOTE_BRANCH}" 2>/dev/null || echo 0)"

if [ "$BEHIND_COUNT" -eq 0 ]; then
  ok "Already up to date (${OLD_SHA}), nothing to deploy"
  systemctl status "$SERVICE_NAME" --no-pager --lines=0 2>/dev/null || true
  exit 0
fi

log "Behind by ${BEHIND_COUNT} commit(s), pulling..."

if [ "$LOCAL_COUNT" -gt 0 ]; then
  log "Warning: ${LOCAL_COUNT} local commit(s) ahead — rebasing"
fi

if ! git pull --rebase origin "$REMOTE_BRANCH"; then
  git rebase --abort 2>/dev/null || true
  fail "git pull --rebase failed (conflicts?). Rebase aborted, server unchanged."
fi

NEW_SHA="$(git rev-parse --short HEAD)"
log "Updated: ${OLD_SHA} → ${NEW_SHA}"

log "Building (pnpm build)..."
BUILD_LOG="$(mktemp)"
if ! pnpm build >"$BUILD_LOG" 2>&1; then
  tail -30 "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  fail "pnpm build failed"
fi
tail -10 "$BUILD_LOG"
rm -f "$BUILD_LOG"

log "Building Control UI (pnpm ui:build)..."
UI_LOG="$(mktemp)"
if ! pnpm ui:build >"$UI_LOG" 2>&1; then
  tail -20 "$UI_LOG"
  rm -f "$UI_LOG"
  fail "pnpm ui:build failed"
fi
tail -5 "$UI_LOG"
rm -f "$UI_LOG"

log "Restarting ${SERVICE_NAME}..."
systemctl restart "$SERVICE_NAME"

sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service ${SERVICE_NAME} is active"
else
  fail "Service ${SERVICE_NAME} is not running after restart"
fi

log "Recent logs:"
journalctl -u "$SERVICE_NAME" --since "10 sec ago" -n 15 --no-pager 2>/dev/null || true

BINARY_PATH="$(readlink -f "$(which openclaw 2>/dev/null)" 2>/dev/null || echo '(not in PATH)')"
log "Binary path: ${BINARY_PATH}"

ok "Deployed ${NEW_SHA} on $(hostname)"
REMOTE_EOF
)

REMOTE_SCRIPT="${REMOTE_SCRIPT//__REMOTE_DIR__/$REMOTE_DIR}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SERVICE_NAME__/$SERVICE_NAME}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__REMOTE_BRANCH__/$REMOTE_BRANCH}"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\033[0;33m[dry-run] ssh %s bash -s <<SCRIPT\n%s\nSCRIPT\033[0m\n' "$SSH_HOST" "$REMOTE_SCRIPT"
else
  printf '%s' "$REMOTE_SCRIPT" | ssh "$SSH_HOST" bash -s
fi

ok "Deploy complete (local: ${LOCAL_SHA})"
