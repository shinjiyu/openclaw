#!/usr/bin/env bash
# E2E: Portal cross-talk (Feishu mocker). Runs gateway in Docker with
# OPENCLAW_E2E_INJECT=1, gets a portal token, connects WS, injects a "feishu" chat
# event (sessionKey agent:main:main), and asserts the portal client would not
# display it (filter works = no cross-talk).
#
# Prefer the local e2e test (faster, no Docker): pnpm test:e2e -- src/gateway/server.portal-crosstalk.e2e.test.ts
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_NAME="openclaw-portal-crosstalk-e2e"
PORT="18789"
NET_NAME="openclaw-crosstalk-$$"
GW_NAME="openclaw-gateway-crosstalk-$$"
FIXTURE_DIR=""

cleanup() {
  docker rm -f "$GW_NAME" 2>/dev/null || true
  docker network rm "$NET_NAME" 2>/dev/null || true
  [[ -n "$FIXTURE_DIR" && -d "$FIXTURE_DIR" ]] && rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR"

FIXTURE_DIR=$(mktemp -d)
cp "$ROOT_DIR/scripts/e2e/fixtures/portal-crosstalk-openclaw.json" "$FIXTURE_DIR/openclaw.json"

echo "Creating Docker network..."
docker network create "$NET_NAME" >/dev/null

echo "Starting gateway (portal + test inject)..."
# Do not use --rm so we can inspect logs if the gateway exits before auth
docker run -d \
  --name "$GW_NAME" \
  --network "$NET_NAME" \
  -e "OPENCLAW_E2E_INJECT=1" \
  -e "OPENCLAW_SKIP_CHANNELS=1" \
  -e "OPENCLAW_SKIP_CRON=1" \
  -e "OPENCLAW_SKIP_CANVAS_HOST=1" \
  -e "OPENCLAW_SKIP_GMAIL_WATCHER=1" \
  -v "$FIXTURE_DIR:/root/.openclaw:rw" \
  "$IMAGE_NAME" \
  bash -lc "entry=dist/index.mjs; [ -f \"\$entry\" ] || entry=dist/index.js; node \"\$entry\" gateway --port $PORT --bind lan --allow-unconfigured > /tmp/gw.log 2>&1"

echo "Waiting for gateway..."
for _ in $(seq 1 40); do
  if docker exec "$GW_NAME" bash -lc "node -e \"
    const net = require('net');
    const s = net.createConnection({ host: '127.0.0.1', port: $PORT });
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => process.exit(1));
  \"" 2>/dev/null; then
    break
  fi
  if docker exec "$GW_NAME" grep -q "listening on ws://" /tmp/gw.log 2>/dev/null; then
    break
  fi
  sleep 0.5
done
# Ensure gateway is still running (it may have crashed after listen)
if ! docker ps -q -f "name=^${GW_NAME}$" | grep -q .; then
  echo "Gateway container exited before auth. Gateway log (/tmp/gw.log):"
  docker cp "$GW_NAME:/tmp/gw.log" /tmp/portal-crosstalk-gw.log 2>/dev/null && tail -n 80 /tmp/portal-crosstalk-gw.log || docker logs "$GW_NAME" 2>&1 | tail -n 50
  exit 1
fi

echo "Getting portal token..."
# -q so Docker does not mix container ID into captured stdout. Allow docker run to fail (e.g. connection refused) so we can print a clear error.
AUTH_RESP=$(docker run --rm -q --network "$NET_NAME" -e "GW_HOST=$GW_NAME" -e "GW_PORT=$PORT" "$IMAGE_NAME" \
  node -e "
const http = require('http');
const host = process.env.GW_HOST || 'localhost';
const port = parseInt(process.env.GW_PORT || '18789', 10);
const opts = { hostname: host, port, path: '/portal/api/auth', method: 'POST', headers: { 'Content-Type': 'application/json' } };
const req = http.request(opts, (res) => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    if (res.statusCode === 200) process.stdout.write(b);
    else process.stdout.write('AUTH_FAIL status=' + res.statusCode + ' body=' + b.slice(0, 500));
  });
});
req.on('error', (e) => { process.stdout.write('AUTH_FAIL status=0 body=request error: ' + e.message); process.exit(1); });
req.write(JSON.stringify({ username: 'admin', password: 'test' }));
req.end();
" 2>/dev/null) || true
if echo "$AUTH_RESP" | grep -q 'AUTH_FAIL'; then
  echo "Portal auth failed: $AUTH_RESP"
  docker exec "$GW_NAME" tail -n 40 /tmp/gw.log
  exit 1
fi
if ! echo "$AUTH_RESP" | grep -q '"token"'; then
  echo "Portal auth missing token (response): ${AUTH_RESP:0:500}"
  docker exec "$GW_NAME" tail -n 40 /tmp/gw.log
  exit 1
fi
PORTAL_TOKEN=$(echo "$AUTH_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

echo "Running portal client + Feishu mocker assertion..."
docker run --rm \
  --network "$NET_NAME" \
  -e "GW_URL=ws://$GW_NAME:$PORT" \
  -e "PORTAL_TOKEN=$PORTAL_TOKEN" \
  "$IMAGE_NAME" \
  node --input-type=module -e "
const WebSocket = (await import('ws')).default;
const url = process.env.GW_URL;
const portalToken = process.env.PORTAL_TOKEN;
if (!url || !portalToken) throw new Error('GW_URL or PORTAL_TOKEN missing');

const ws = new WebSocket(url);
const displayed = [];
const myPortalSegment = 'portal:admin';

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('ws open timeout')), 8000);
  ws.once('open', () => { clearTimeout(t); resolve(); });
  ws.on('error', reject);
});

ws.on('message', (data) => {
  let obj;
  try { obj = JSON.parse(String(data)); } catch { return; }
  if (obj.type !== 'ev' || obj.event !== 'chat') return;
  const sk = (obj.payload?.sessionKey || '').toLowerCase();
  if (sk && sk.includes(myPortalSegment)) displayed.push(obj.payload);
});

ws.send(JSON.stringify({
  type: 'req',
  id: 'c1',
  method: 'connect',
  params: {
    minProtocol: 1,
    maxProtocol: 1,
    client: { id: 'e2e', displayName: 'WebChat Portal', version: '1.0.0', platform: 'node', mode: 'test' },
    caps: [],
    auth: { token: portalToken },
  },
}));

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('connect res timeout')), 5000);
  const handler = (data) => {
    const o = JSON.parse(String(data));
    if (o.type === 'res' && o.id === 'c1') {
      clearTimeout(t);
      ws.off('message', handler);
      if (!o.ok) reject(new Error(o.error?.message || 'connect failed'));
      else resolve();
    }
  };
  ws.on('message', handler);
});

await new Promise(r => setTimeout(r, 200));

const countBefore = displayed.length;
const injectPayload = {
  sessionKey: 'agent:main:main',
  state: 'final',
  message: { content: [{ type: 'text', text: 'feishu mocker message' }] },
};

const http = await import('node:http');
const gwUrl = new URL(process.env.GW_URL || 'ws://localhost:18789');
const injectReq = http.request({
  hostname: gwUrl.hostname,
  port: gwUrl.port || 18789,
  path: '/test/inject-broadcast',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
}, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    if (res.statusCode !== 200) throw new Error('inject failed: ' + body);
  });
});
injectReq.write(JSON.stringify({ event: 'chat', payload: injectPayload }));
injectReq.end();

await new Promise(r => setTimeout(r, 1500));
ws.close();

const countAfter = displayed.length;
const crosstalk = countAfter > countBefore && displayed.some(p => (p.sessionKey || '').includes('agent:main:main'));
if (crosstalk) {
  console.error('FAIL: portal displayed a feishu (agent:main:main) message — cross-talk');
  process.exit(1);
}
console.log('OK: no cross-talk (feishu inject filtered by portal)');
" 2>&1

echo "Done."
