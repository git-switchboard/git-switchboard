#!/usr/bin/env bash
set -euo pipefail

# E2E test orchestrator
# 1. Starts a local verdaccio registry (with ephemeral storage)
# 2. Builds and publishes git-switchboard to it
# 3. Runs e2e tests against the published package
# 4. Tears everything down

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pick a random high port to avoid conflicts with stale processes
VERDACCIO_PORT="${VERDACCIO_PORT:-$(shuf -i 10000-60000 -n 1)}"
VERDACCIO_URL="http://localhost:${VERDACCIO_PORT}"
VERDACCIO_PID=""
VERDACCIO_DIR=""

cleanup() {
  if [ -n "$VERDACCIO_PID" ]; then
    echo "Stopping verdaccio (pid $VERDACCIO_PID)..."
    # Kill the entire process group spawned by setsid
    kill -- -"$VERDACCIO_PID" 2>/dev/null || kill "$VERDACCIO_PID" 2>/dev/null || true
    wait "$VERDACCIO_PID" 2>/dev/null || true
  fi
  if [ -n "$VERDACCIO_DIR" ] && [ -d "$VERDACCIO_DIR" ]; then
    rm -rf "$VERDACCIO_DIR"
  fi
  # Clean up the shared install dir used by the test harness
  rm -rf "${TMPDIR:-/tmp}/git-switchboard-e2e-install"
}
trap cleanup EXIT

echo "==> Building git-switchboard..."
cd "$PKG_DIR"
bun run build

# Create ephemeral verdaccio home so storage & htpasswd don't persist
VERDACCIO_DIR="$(mktemp -d)"
cp "$SCRIPT_DIR/verdaccio.yml" "$VERDACCIO_DIR/verdaccio.yml"

echo "==> Starting verdaccio on port ${VERDACCIO_PORT}..."
# setsid gives verdaccio its own process group for reliable cleanup
setsid npx verdaccio \
  --config "$VERDACCIO_DIR/verdaccio.yml" \
  --listen "$VERDACCIO_PORT" &
VERDACCIO_PID=$!

# Wait for verdaccio to be ready
for i in $(seq 1 30); do
  if curl -sf "$VERDACCIO_URL/-/ping" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: verdaccio did not start within 30s"
    exit 1
  fi
  sleep 1
done
echo "==> Verdaccio is ready at ${VERDACCIO_URL}"

echo "==> Creating verdaccio user and obtaining auth token..."
RESP=$(curl -s -X PUT \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e","password":"e2e12345"}' \
  "$VERDACCIO_URL/-/user/org.couchdb.user:e2e")
TOKEN=$(echo "$RESP" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).token ?? ''")

if [ -z "$TOKEN" ]; then
  echo "ERROR: failed to obtain auth token. Response: $RESP"
  exit 1
fi

echo "==> Publishing git-switchboard to local registry..."
cd "$PKG_DIR"

# Write a temporary .npmrc with the auth token so npm publish authenticates
E2E_NPMRC="$VERDACCIO_DIR/.npmrc"
cat > "$E2E_NPMRC" <<NPMRC
registry=${VERDACCIO_URL}/
//localhost:${VERDACCIO_PORT}/:_authToken=${TOKEN}
NPMRC

npm publish \
  --registry "$VERDACCIO_URL" \
  --tag e2e \
  --no-git-checks \
  --userconfig "$E2E_NPMRC" 2>&1

echo "==> Running e2e tests..."
VERDACCIO_URL="$VERDACCIO_URL" bun test "$SCRIPT_DIR" --timeout 60000

echo "==> E2E tests passed!"
