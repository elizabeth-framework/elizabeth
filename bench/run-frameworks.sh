#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/bench/elizabeth-app"
PORT="${PORT:-3811}"
BOMBARDIER="${BOMBARDIER:-bombardier}"
CONNECTIONS="${CONNECTIONS:-100}"
DURATION="${DURATION:-10s}"

if ! command -v "$BOMBARDIER" >/dev/null 2>&1 && [ ! -x "$BOMBARDIER" ]; then
  echo "bombardier not found. Set BOMBARDIER=/path/to/bombardier" >&2
  exit 1
fi

cd "$APP"
bun ../../src/cli.ts build >/tmp/elizabeth-bench-build.log 2>&1
cd "$ROOT"

echo "Framework benchmark"
echo "Bun: $(bun --version)"
echo "Tool: $($BOMBARDIER --version 2>/dev/null || echo "$BOMBARDIER")"
echo "Connections: $CONNECTIONS"
echo "Duration: $DURATION"
echo

run_server_case() {
  local framework="$1"
  local command="$2"
  local log_file="/tmp/elizabeth-bench-${framework}.log"

  echo "## $framework"
  PORT="$PORT" bash -lc "$command" > "$log_file" 2>&1 &
  local server_pid="$!"

  cleanup_server() {
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  }

  for _ in {1..100}; do
    if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.05
  done

  run_benchmark "$framework" "page /" "/"
  run_benchmark "$framework" "dynamic page /users/ada" "/users/ada"
  run_benchmark "$framework" "plain api /plain" "/plain"
  run_benchmark "$framework" "json api /json" "/json"

  cleanup_server
  echo
}

run_benchmark() {
  local framework="$1"
  local name="$2"
  local path="$3"

  echo "== $framework: $name =="
  "$BOMBARDIER" -c "$CONNECTIONS" -d "$DURATION" -l "http://127.0.0.1:$PORT$path"
  echo
}

run_server_case "elizabeth" "cd '$APP' && ELIZABETH_REQUEST_LOGS=0 PORT='$PORT' bun dist/server.js"
run_server_case "native-bun" "cd '$ROOT' && bun bench/servers/native-bun.ts"
run_server_case "elysia" "cd '$ROOT/bench' && bun servers/elysia.ts"
run_server_case "hono" "cd '$ROOT/bench' && bun servers/hono.ts"
