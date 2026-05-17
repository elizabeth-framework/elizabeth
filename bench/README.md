# Elizabeth Benchmarks

This directory is for local performance benchmarking. Keep functional tests in `tests/`.

## Tools

The benchmark runners use `bombardier`.

Install it with Go:

```sh
go install github.com/codesenberg/bombardier@latest
```

Then pass the binary path when running:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" ...
```

## Elizabeth-Only Benchmark

Runs the production build of `bench/elizabeth-app` only:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" bench/run-bombardier.sh
```

Configurable environment variables:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" \
DURATION=20s \
CONNECTIONS=1000 \
PORT=3811 \
bench/run-bombardier.sh
```

Routes:

- `/`
- `/users/ada`
- `/plain`
- `/json`

## Framework Comparison

Runs Elizabeth, native Bun, Elysia, Hono, and Fastify one at a time on the same port:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" bench/run-frameworks.sh
```

The comparison uses the same route shapes as the Elizabeth-only benchmark.

## Markdown Summary

Both runners write a verbose log per case. To collapse them into a single Markdown comparison table (req/s, p50, p99 per framework × route), pipe the output through `bench/summarize.ts`:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" bench/run-frameworks.sh | bun bench/summarize.ts > bench-results.md
```

You can also save the raw run first and re-parse it later:

```sh
BOMBARDIER="$(go env GOPATH)/bin/bombardier" bench/run-frameworks.sh > bench-raw.txt
bun bench/summarize.ts bench-raw.txt
```

## Setup

Install comparison dependencies inside `bench/`:

```sh
cd bench
bun install
```

This installs only benchmark dependencies such as Elysia and Hono. It is intentionally separate from the root package dependencies.

## Caveats

Benchmarks are local-machine numbers. Do not compare them directly with published framework benchmark tables unless hardware, Bun version, OS limits, benchmark tool, route implementation, response body size, and connection settings match.

Elizabeth production request logs are disabled by the runners with:

```sh
ELIZABETH_REQUEST_LOGS=0
```

This avoids measuring console I/O instead of request handling.

Generated files such as `bench/elizabeth-app/dist/`, `bench/node_modules/`, and `bench/bun.lock` are local benchmark artifacts.
