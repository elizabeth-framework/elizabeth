const unitMs: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  w: 604_800_000,
  wk: 604_800_000,
};

const durationComponentRegex = /(-?\d+(?:\.\d+)?)\s*([a-z]+)?/gi;

export function parseDuration(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new TypeError("parseDuration: numeric input must be finite");
    }
    return Math.round(input);
  }

  if (typeof input !== "string" || input.trim().length === 0) {
    throw new TypeError("parseDuration: input must be a non-empty string");
  }

  const trimmed = input.trim();
  let total = 0;
  let matched = false;

  durationComponentRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = durationComponentRegex.exec(trimmed)) !== null) {
    matched = true;
    const value = Number(match[1]);
    const unit = (match[2] ?? "ms").toLowerCase();
    const multiplier = unitMs[unit];

    if (multiplier === undefined) {
      throw new TypeError(`parseDuration: unknown unit ${JSON.stringify(unit)}`);
    }

    total += value * multiplier;
  }

  if (!matched) {
    throw new TypeError(`parseDuration: invalid input ${JSON.stringify(input)}`);
  }

  const leftover = trimmed.replace(durationComponentRegex, "").replace(/\s+/g, "");
  if (leftover.length > 0) {
    throw new TypeError(`parseDuration: invalid trailing characters in ${JSON.stringify(input)}`);
  }

  return Math.round(total);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "∞";
  }

  const abs = Math.abs(ms);
  const sign = ms < 0 ? "-" : "";

  if (abs < 1_000) return `${sign}${Math.round(abs)}ms`;
  if (abs < 60_000) return `${sign}${(abs / 1_000).toFixed(abs < 10_000 ? 1 : 0)}s`;
  if (abs < 3_600_000) return `${sign}${Math.floor(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${sign}${Math.floor(abs / 3_600_000)}h`;
  if (abs < 604_800_000) return `${sign}${Math.floor(abs / 86_400_000)}d`;
  return `${sign}${Math.floor(abs / 604_800_000)}w`;
}

const relativeUnits: Array<readonly [number, Intl.RelativeTimeFormatUnit]> = [
  [604_800_000, "week"],
  [86_400_000, "day"],
  [3_600_000, "hour"],
  [60_000, "minute"],
  [1_000, "second"],
];

export function formatRelative(target: Date | number, now: Date | number = new Date()): string {
  const targetMs = target instanceof Date ? target.getTime() : target;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);

  if (abs < 1000) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unitSize, unit] of relativeUnits) {
    if (abs >= unitSize) {
      const value = Math.round(diff / unitSize);
      return formatter.format(value, unit);
    }
  }

  return "just now";
}
