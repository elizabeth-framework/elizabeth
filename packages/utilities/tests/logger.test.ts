import { expect, test, describe } from "bun:test";
import { createLogger } from "../src/logger.ts";

function makeSink() {
  const calls: { level: string; args: unknown[] }[] = [];
  return {
    calls,
    debug: (...args: unknown[]) => calls.push({ level: "debug", args }),
    info: (...args: unknown[]) => calls.push({ level: "info", args }),
    warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
    error: (...args: unknown[]) => calls.push({ level: "error", args }),
  };
}

describe("createLogger()", () => {
  test("respects level threshold", () => {
    const sink = makeSink();
    const logger = createLogger("app", { level: "warn", output: sink });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(sink.calls.map((c) => c.level)).toEqual(["warn", "error"]);
  });

  test("silent suppresses everything", () => {
    const sink = makeSink();
    const logger = createLogger("app", { level: "silent", output: sink });
    logger.error("e");
    expect(sink.calls).toEqual([]);
  });

  test("prefixes with namespace", () => {
    const sink = makeSink();
    const logger = createLogger("ns", { level: "debug", output: sink });
    logger.info("hello", 1);
    expect(sink.calls[0].args[0]).toBe("[ns]");
    expect(sink.calls[0].args.slice(1)).toEqual(["hello", 1]);
  });

  test("child() extends the namespace", () => {
    const sink = makeSink();
    const logger = createLogger("ns", { level: "debug", output: sink }).child("sub");
    logger.info("x");
    expect(sink.calls[0].args[0]).toBe("[ns:sub]");
  });

  test("timestamp option adds an ISO prefix", () => {
    const sink = makeSink();
    const logger = createLogger("ns", { level: "debug", output: sink, timestamp: true });
    logger.info("x");
    expect(String(sink.calls[0].args[0])).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] \[ns\]$/);
  });
});
