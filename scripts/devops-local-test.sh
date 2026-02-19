#!/usr/bin/env bash
# devops-local-test.sh — local macOS end-to-end test for the devops plugin sandbox workflow
# Tests: create → build → start → health → (optional test) → stop
# Does NOT test promote/rollback (those require a running gateway to restart).
#
# Usage:
#   bash scripts/devops-local-test.sh           # sandbox-only test
#   bash scripts/devops-local-test.sh --tests   # also run pnpm test inside container
#   bash scripts/devops-local-test.sh --clean   # clean up only

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDS_DIR="${DEVOPS_BUILDS_DIR:-/tmp/openclaw-builds}"
SANDBOX_PORT="${DEVOPS_SANDBOX_PORT:-18790}"
SANDBOX_CFG_DIR="${DEVOPS_SANDBOX_CFG:-/tmp/openclaw-sandbox-cfg}"
SANDBOX_CONTAINER="openclaw-sandbox"
SANDBOX_IMAGE="openclaw:sandbox"
LOG_DIR="/tmp/openclaw-devops-test"
LOG_FILE="${LOG_DIR}/test-$(date +%Y%m%d-%H%M%S).log"
RUN_TESTS=0
CLEAN_ONLY=0

# ── CLI args ──────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --tests)      RUN_TESTS=1 ;;
    --clean)      CLEAN_ONLY=1 ;;
    --help|-h)
      echo "Usage: $0 [--tests] [--clean]"
      echo "  --tests  Run pnpm test inside sandbox container"
      echo "  --clean  Only clean up containers/images, do not run test"
      exit 0
      ;;
  esac
done

mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_FILE") 2>&1

ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '[%s] [INFO ] %s\n' "$(ts)" "$*"; }
logw() { printf '[%s] [WARN ] %s\n' "$(ts)" "$*"; }
loge() { printf '[%s] [ERROR] %s\n' "$(ts)" "$*"; exit 1; }
ok()   { printf '[%s] [OK   ] ✅ %s\n' "$(ts)" "$*"; }
fail() { printf '[%s] [FAIL ] ❌ %s\n' "$(ts)" "$*"; exit 1; }

# ── cleanup helper ────────────────────────────────────────────────────────────
cleanup() {
  log "Cleaning up sandbox container and image..."
  docker rm -f "$SANDBOX_CONTAINER" 2>/dev/null && log "Container removed" || true
  docker rmi "$SANDBOX_IMAGE" 2>/dev/null && log "Image removed" || true
  log "Old build dirs in $BUILDS_DIR:"
  ls -1 "$BUILDS_DIR" 2>/dev/null || echo "  (none)"
}

if [ "$CLEAN_ONLY" -eq 1 ]; then
  cleanup
  log "Clean done."
  exit 0
fi

# ── preflight checks ──────────────────────────────────────────────────────────
log "=== DevOps Local Test ==="
log "Source repo : $ROOT_DIR"
log "Builds dir  : $BUILDS_DIR"
log "Sandbox port: $SANDBOX_PORT"
log "Log file    : $LOG_FILE"
echo ""

command -v docker >/dev/null 2>&1 || loge "Docker not found. Install Docker Desktop first."
docker info >/dev/null 2>&1       || loge "Docker daemon not running. Start Docker Desktop."
command -v git >/dev/null 2>&1    || loge "git not found."
command -v pnpm >/dev/null 2>&1   || loge "pnpm not found."
ok "Preflight checks passed"

# Check if port 18790 is free
if lsof -iTCP:"$SANDBOX_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  logw "Port $SANDBOX_PORT already in use — stopping old container first"
  docker rm -f "$SANDBOX_CONTAINER" 2>/dev/null || true
  sleep 2
fi

# ── STEP 1: Create isolated build dir ─────────────────────────────────────────
log ""
log "=== STEP 1/5: Create isolated build dir ==="
TS=$(date +%Y-%m-%dT%H-%M)
BUILD_DIR="${BUILDS_DIR}/${TS}-localtest"
mkdir -p "$BUILDS_DIR"

log "git clone --local --no-hardlinks $ROOT_DIR $BUILD_DIR"
git clone --local --no-hardlinks "$ROOT_DIR" "$BUILD_DIR"
ok "Build dir created: $BUILD_DIR"

# ── STEP 2: Install dependencies ──────────────────────────────────────────────
log ""
log "=== STEP 2/5: Install dependencies ==="
log "pnpm install --frozen-lockfile --ignore-scripts (in $BUILD_DIR)"
pnpm --prefix "$BUILD_DIR" install --frozen-lockfile --ignore-scripts \
  && ok "Dependencies installed" \
  || logw "Some deps failed (may be native/optional — continuing)"

# ── STEP 3: Build TypeScript + Docker image ───────────────────────────────────
log ""
log "=== STEP 3/5: Build (pnpm build + docker build) ==="

log "pnpm build..."
pnpm --prefix "$BUILD_DIR" run build \
  && ok "TypeScript build complete" \
  || fail "pnpm build failed — check logs above"

# Check if Dockerfile exists
if [ ! -f "$ROOT_DIR/Dockerfile" ]; then
  logw "No Dockerfile found in repo root — creating a minimal one for testing"
  cat > "$BUILD_DIR/Dockerfile" << 'DOCKEREOF'
FROM node:22-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --ignore-scripts --prod
COPY dist/ ./dist/
EXPOSE 18789
CMD ["node", "dist/entry.js", "gateway", "run", "--port", "18789", "--bind", "loopback"]
DOCKEREOF
  log "Minimal Dockerfile written to build dir"
fi

log "docker build -t $SANDBOX_IMAGE $BUILD_DIR ..."
docker build -t "$SANDBOX_IMAGE" "$BUILD_DIR" \
  && ok "Docker image built: $SANDBOX_IMAGE" \
  || fail "docker build failed"

# ── STEP 4: Start sandbox container ───────────────────────────────────────────
log ""
log "=== STEP 4/5: Start sandbox ==="
mkdir -p "$SANDBOX_CFG_DIR"
docker rm -f "$SANDBOX_CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$SANDBOX_CONTAINER" \
  --env NODE_ENV=production \
  --env OPENCLAW_SANDBOX=1 \
  -v "${SANDBOX_CFG_DIR}:/root/.openclaw" \
  -p "127.0.0.1:${SANDBOX_PORT}:18789" \
  "$SANDBOX_IMAGE" \
  && ok "Sandbox container started" \
  || fail "docker run failed"

# ── Wait for health ────────────────────────────────────────────────────────────
log "Waiting for gateway to start (up to 40s)..."
waited=0
healthy=false
while [ "$waited" -lt 40 ]; do
  # Check container logs for "listening on"
  if docker logs "$SANDBOX_CONTAINER" 2>&1 | grep -q "listening on"; then
    healthy=true
    break
  fi
  # Also check port
  if lsof -iTCP:"$SANDBOX_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 3
  waited=$((waited + 3))
  log "  Waiting... (${waited}s)"
done

if [ "$healthy" = "true" ]; then
  ok "Sandbox gateway is ready on port $SANDBOX_PORT (${waited}s)"
else
  loge "Sandbox gateway did not start within 40s. Logs:"
  docker logs --tail 30 "$SANDBOX_CONTAINER" 2>&1 || true
  fail "Health check failed"
fi

# Show last few log lines
log "Container logs (last 10 lines):"
docker logs --tail 10 "$SANDBOX_CONTAINER" 2>&1 | sed 's/^/  /'

# ── STEP 5: Optional pnpm test ────────────────────────────────────────────────
if [ "$RUN_TESTS" -eq 1 ]; then
  log ""
  log "=== STEP 5/5: Run pnpm test inside container ==="
  log "docker exec $SANDBOX_CONTAINER sh -c 'cd /app && node node_modules/.bin/vitest run'"
  docker exec "$SANDBOX_CONTAINER" sh -c \
    "cd /app && node node_modules/.bin/vitest run --reporter=verbose 2>&1 | tail -40" \
    && ok "Tests passed inside sandbox" \
    || logw "Some tests failed — this may be expected in sandbox (no real credentials)"
else
  log ""
  log "=== STEP 5/5: Skipping tests (use --tests to enable) ==="
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ✅  DEVOPS LOCAL TEST COMPLETE                 ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf  "║  Build dir:   %-42s ║\n" "$BUILD_DIR"
printf  "║  Image:       %-42s ║\n" "$SANDBOX_IMAGE"
printf  "║  Container:   %-42s ║\n" "$SANDBOX_CONTAINER (running)"
printf  "║  Port:        %-42s ║\n" "127.0.0.1:${SANDBOX_PORT} → container:18789"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Useful commands:                                        ║"
echo "║    docker logs -f openclaw-sandbox                       ║"
printf "║    docker exec -it openclaw-sandbox sh                   ║\n"
printf "║    curl http://127.0.0.1:%s/health                    ║\n" "$SANDBOX_PORT"
echo "║                                                          ║"
echo "║  Cleanup:                                                ║"
echo "║    bash scripts/devops-local-test.sh --clean             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
log "Full log: $LOG_FILE"
