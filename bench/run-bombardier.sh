#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/bench/elizabeth-app"
PORT="${PORT:-3811}"
BOMBARDIER="${BOMBARDIER:-bombardier}"
CONNECTIONS="${CONNECTIONS:-100}"
DURATION="${DURATION:-10s}"

cd "$APP"
bun ../../src/cli.ts build

ELIZABETH_REQUEST_LOGS=0 PORT="$PORT" bun dist/server.js > /tmp/elizabeth-bench-server.log 2>&1 &
SERVER_PID="$!"

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..100}; do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.05
done

echo "Elizabeth production benchmark"
echo "Bun: $(bun --version)"
echo "Tool: $($BOMBARDIER --version 2>/dev/null || echo "$BOMBARDIER")"
echo "Port: $PORT"
echo "Connections: $CONNECTIONS"
echo "Duration: $DURATION"
echo

run_case() {
  local name="$1"
  local path="$2"
  echo "== $name =="
  "$BOMBARDIER" -c "$CONNECTIONS" -d "$DURATION" -l "http://127.0.0.1:$PORT$path"
  echo
}

run_case "page /" "/"
run_case "dynamic page /users/ada" "/users/ada"
run_case "plain api /plain" "/plain"
run_case "json api /json" "/json"
