import { randomToken, signValue, unsignValue } from "@elizabeth-js/crypto";

export function generateCsrfToken(secret: string, randomBytes = 16): string {
  return signValue(randomToken(randomBytes), secret);
}

export function verifyCsrfToken(token: string | null | undefined, secret: string): boolean {
  if (!token) {
    return false;
  }
  return unsignValue(token, secret) !== null;
}
