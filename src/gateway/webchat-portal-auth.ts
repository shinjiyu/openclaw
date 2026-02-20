import { randomBytes } from "node:crypto";
import type { GatewayWebchatPortalUser } from "../config/types.gateway.js";
import { safeEqualSecret } from "../security/secret-equal.js";

export const PORTAL_SESSION_KEY_PREFIX = "portal:";

/** Derive a stable, per-user session key for webchat portal sessions. */
export function portalSessionKey(username: string): string {
  return `${PORTAL_SESSION_KEY_PREFIX}${username.toLowerCase()}`;
}

export type PortalTokenEntry = {
  username: string;
  agentId?: string;
  expiresAt: number;
};

/**
 * In-memory store for portal session tokens.
 * Tokens are short-lived bearer tokens issued on successful login.
 * They are lost on gateway restart (users must log in again).
 */
export class PortalTokenStore {
  private tokens = new Map<string, PortalTokenEntry>();

  issue(username: string, ttlHours: number, agentId?: string): string {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;
    this.tokens.set(token, { username, agentId, expiresAt });
    this.evictExpired();
    return token;
  }

  verify(token: string): PortalTokenEntry | null {
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /** Remove all expired entries to prevent unbounded growth. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (now > entry.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

/**
 * Gateway-scoped singleton token store.
 * Shared between the HTTP handler (issues tokens) and the WebSocket
 * connection handler (verifies tokens), avoiding DI threading.
 */
export const gatewayPortalTokenStore = new PortalTokenStore();

/**
 * Validate portal login credentials against the configured user list.
 * Returns the matching user entry or null on failure.
 */
export function validatePortalCredentials(
  username: string,
  password: string,
  users: GatewayWebchatPortalUser[],
): GatewayWebchatPortalUser | null {
  const normalizedUsername = username.trim().toLowerCase();
  for (const user of users) {
    if (user.username.trim().toLowerCase() !== normalizedUsername) {
      continue;
    }
    if (safeEqualSecret(password, user.password)) {
      return user;
    }
    // Wrong password – stop checking to prevent timing oracle.
    return null;
  }
  return null;
}
