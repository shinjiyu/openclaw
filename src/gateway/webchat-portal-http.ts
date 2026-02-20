import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { GatewayWebchatPortalConfig } from "../config/types.gateway.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import {
  gatewayPortalTokenStore,
  validatePortalCredentials,
  type PortalTokenStore,
} from "./webchat-portal-auth.js";
import { buildPortalHtml } from "./webchat-portal-ui.js";

export const PORTAL_DEFAULT_BASE_PATH = "/portal";
export const PORTAL_DEFAULT_TOKEN_TTL_HOURS = 24;
export const PORTAL_DEFAULT_CHAT_MODE = true;

/** Resolve the base path, stripping any trailing slash. */
export function resolvePortalBasePath(cfg: GatewayWebchatPortalConfig): string {
  const raw = cfg.basePath?.trim() || PORTAL_DEFAULT_BASE_PATH;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

type ReadBodyResult = { ok: true; body: string } | { ok: false; error: string };

async function readJsonBody(req: IncomingMessage, maxBytes = 65536): Promise<ReadBodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve({ ok: false, error: "Request body too large" });
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      resolve({ ok: true, body: Buffer.concat(chunks).toString("utf-8") });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: String(err) });
    });
  });
}

export type PortalHttpHandlerOptions = {
  cfg: GatewayWebchatPortalConfig;
  /** Defaults to the gateway singleton store when omitted. */
  tokenStore?: PortalTokenStore;
  port: number;
  bindHost: string;
};

/**
 * Handle HTTP requests for the WebChat Portal.
 * Returns true if the request was handled, false if it should fall through.
 */
export async function handleWebchatPortalHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: PortalHttpHandlerOptions,
): Promise<boolean> {
  const { cfg } = opts;
  const tokenStore = opts.tokenStore ?? gatewayPortalTokenStore;
  // Resolve assistant name from current config for the page title.
  const assistantName = (() => {
    try {
      const config = loadConfig();
      return resolveAssistantIdentity({ cfg: config }).name;
    } catch {
      return DEFAULT_ASSISTANT_IDENTITY.name;
    }
  })();
  const basePath = resolvePortalBasePath(cfg);

  const url = new URL(req.url ?? "/", `http://${opts.bindHost}:${opts.port}`);
  const pathname = url.pathname;

  if (pathname !== basePath && pathname !== `${basePath}/` && !pathname.startsWith(`${basePath}/`)) {
    return false;
  }

  const subPath = pathname.slice(basePath.length) || "/";

  // ── POST /api/auth → login ───────────────────────────────
  if (req.method === "POST" && subPath === "/api/auth") {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendJson(res, 400, { error: bodyResult.error });
      return true;
    }

    let parsed: { username?: unknown; password?: unknown };
    try {
      parsed = JSON.parse(bodyResult.body);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return true;
    }

    const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
    const password = typeof parsed.password === "string" ? parsed.password : "";

    if (!username || !password) {
      sendJson(res, 400, { error: "username and password are required" });
      return true;
    }

    const users = cfg.users ?? [];
    const user = validatePortalCredentials(username, password, users);
    if (!user) {
      // Consistent response time to resist timing attacks
      await new Promise((r) => setTimeout(r, 200));
      sendJson(res, 401, { error: "Invalid username or password" });
      return true;
    }

    const ttlHours = cfg.tokenTtlHours ?? PORTAL_DEFAULT_TOKEN_TTL_HOURS;
    const token = tokenStore.issue(user.username, ttlHours, user.agentId);
    sendJson(res, 200, { token, username: user.username });
    return true;
  }

  // ── GET /api/auth (token verify – used by SPA reconnect) ─
  if (req.method === "GET" && subPath === "/api/auth") {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const entry = token ? tokenStore.verify(token) : null;
    if (entry) {
      sendJson(res, 200, { ok: true, username: entry.username });
    } else {
      sendJson(res, 401, { ok: false, error: "Invalid or expired token" });
    }
    return true;
  }

  // ── DELETE /api/auth → logout ────────────────────────────
  if (req.method === "DELETE" && subPath === "/api/auth") {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      tokenStore.revoke(token);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ── GET / or /login → serve SPA ─────────────────────────
  if (req.method === "GET" && (subPath === "/" || subPath === "" || subPath === "/login")) {
    const html = buildPortalHtml({ basePath, assistantName });
    sendHtml(res, html);
    return true;
  }

  // ── Any other portal path ─────────────────────────────────
  if (req.method === "GET") {
    // Redirect unknown GET paths to portal root (SPA handles routing)
    res.writeHead(302, { Location: `${basePath}/` });
    res.end();
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

/**
 * Create a pre-configured portal request handler suitable for use as a
 * drop-in HooksRequestHandler in `createGatewayHttpServer`.
 */
export function createWebchatPortalRequestHandler(opts: {
  cfg: GatewayWebchatPortalConfig;
  port: number;
  bindHost: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return (req, res) =>
    handleWebchatPortalHttpRequest(req, res, {
      ...opts,
      tokenStore: gatewayPortalTokenStore,
    });
}
