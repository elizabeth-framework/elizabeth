import { randomBytes, randomUUID } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;
const MAX_TIMESTAMP = 2 ** 48 - 1;

export function generateId(timestamp: number = Date.now()): string {
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP) {
    throw new RangeError(`generateId: timestamp must be an integer between 0 and ${MAX_TIMESTAMP}`);
  }

  return encodeTime(timestamp) + encodeRandom();
}

export function parseIdTime(id: string): Date {
  if (typeof id !== "string" || id.length < TIME_LEN) {
    throw new TypeError(`parseIdTime: id must be a string of at least ${TIME_LEN} characters`);
  }

  let value = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const ch = id[i].toUpperCase();
    const idx = CROCKFORD.indexOf(ch);
    if (idx === -1) {
      throw new TypeError(`parseIdTime: invalid character ${JSON.stringify(ch)} at position ${i}`);
    }
    value = value * 32 + idx;
  }

  return new Date(value);
}

export function randomId(): string {
  return randomUUID();
}

function encodeTime(timestamp: number): string {
  let chars = "";
  let value = timestamp;
  for (let i = 0; i < TIME_LEN; i++) {
    chars = CROCKFORD[value % 32] + chars;
    value = Math.floor(value / 32);
  }
  return chars;
}

function encodeRandom(): string {
  const bytes = randomBytes(RAND_LEN);
  let chars = "";
  for (let i = 0; i < RAND_LEN; i++) {
    chars += CROCKFORD[bytes[i] % 32];
  }
  return chars;
}
