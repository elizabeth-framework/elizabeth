import { hashPassword, verifyPassword } from "./auth.ts";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
}

const users = new Map<string, User>();

export async function createUser(username: string, password: string): Promise<User> {
  const normalized = username.trim().toLowerCase();

  if (users.has(normalized)) {
    throw new Error("Username is already taken.");
  }

  if (normalized.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const user: User = {
    id: crypto.randomUUID(),
    username: normalized,
    passwordHash: await hashPassword(password),
  };

  users.set(normalized, user);
  return user;
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const user = users.get(username.trim().toLowerCase());

  if (!user) {
    return null;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export function findUserById(id: string): User | null {
  for (const user of users.values()) {
    if (user.id === id) {
      return user;
    }
  }

  return null;
}
