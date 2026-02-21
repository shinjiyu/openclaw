/**
 * E2E: Portal auth/connect scenarios.
 * - Invalid/stale token → INVALID_REQUEST (not pairing required)
 * - Fresh token (just issued) → connection succeeds
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { writeConfigFile } from "../config/config.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import {
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "test" });

const PORTAL_CONFIG = {
  gateway: {
    webchatPortal: {
      enabled: true,
      basePath: "/portal",
      chatMode: true,
      users: [{ username: "admin", password: "test" }],
    },
  },
  agents: { list: [] as unknown[] },
};

describe("portal pairing required (e2e)", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;
  let prevE2EInject: string | undefined;

  beforeEach(async () => {
    prevE2EInject = process.env.OPENCLAW_E2E_INJECT;
    process.env.OPENCLAW_E2E_INJECT = "1";
    await writeConfigFile(PORTAL_CONFIG as Record<string, unknown>);
    port = await getFreePort();
    server = await startGatewayServer(port);
  }, 60_000);

  afterEach(async () => {
    await server.close();
    if (prevE2EInject === undefined) delete process.env.OPENCLAW_E2E_INJECT;
    else process.env.OPENCLAW_E2E_INJECT = prevE2EInject;
  });

  test("connect with invalid portal token triggers device identity required or pairing required", {
    timeout: 15_000,
  }, async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws open timeout")), 8000);
      ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.on("error", reject);
    });

    const connectId = "pairing-req-test-1";
    ws.send(
      JSON.stringify({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: "webchat",
            displayName: "WebChat Portal",
            version: "1.0.0",
            platform: "node",
            mode: "webchat",
          },
          caps: [],
          auth: { token: "invalid-token-not-in-store" },
        },
      }),
    );

    let connectRes: { ok?: boolean; error?: { code?: number; message?: string } };
    let closeCode: number | undefined;
    let closeReason = "";
    ws.on("close", (code, reason) => {
      closeCode = code;
      closeReason = reason.toString();
    });

    try {
      connectRes = await onceMessage(
        ws,
        (o) => (o as { type?: string; id?: string }).type === "res" && (o as { id?: string }).id === connectId,
        5000,
      ) as typeof connectRes;
    } catch (err) {
      if (closeCode !== undefined) {
        expect(closeCode).toBe(1008);
        expect(closeReason.toLowerCase()).toMatch(/device identity required|pairing required|token mismatch|unauthorized/i);
        return;
      }
      throw err;
    }

    expect(connectRes.ok).toBe(false);
    // Invalid/expired portal token → rejectUnauthorized (token_mismatch) → INVALID_REQUEST
    expect(connectRes.error?.code).toBe("INVALID_REQUEST");
    const msg = (connectRes.error?.message ?? "").toLowerCase();
    expect(
      msg.includes("session expired") ||
      msg.includes("sign in again") ||
      msg.includes("device identity required") ||
      msg.includes("pairing required") ||
      msg.includes("token") ||
      msg.includes("unauthorized"),
    ).toBe(true);
  });

  test("fresh portal token (just issued) allows WS connection", {
    timeout: 15_000,
  }, async () => {
    // Step 1: login to get a fresh token
    const authRes = await fetch(`http://127.0.0.1:${port}/portal/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test" }),
    });
    expect(authRes.ok, "login should succeed").toBe(true);
    const authJson = (await authRes.json()) as { token?: string };
    expect(authJson.token, "token should be returned").toBeDefined();
    const freshToken = authJson.token as string;

    // Step 2: connect WS with fresh token
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws open timeout")), 8000);
      ws.once("open", () => { clearTimeout(t); resolve(); });
      ws.on("error", reject);
    });

    const connectId = "fresh-token-test-1";
    ws.send(JSON.stringify({
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: "webchat",
          displayName: "WebChat Portal",
          version: "1.0.0",
          platform: "node",
          mode: "webchat",
        },
        caps: [],
        auth: { token: freshToken },
      },
    }));

    const connectRes = await onceMessage(
      ws,
      (o) => (o as { type?: string; id?: string }).type === "res" && (o as { id?: string }).id === connectId,
      8000,
    ) as { ok?: boolean; error?: { code?: string; message?: string } };

    ws.close();
    // A fresh token MUST be accepted
    expect(connectRes.ok, connectRes.error?.message ?? "connect should succeed with fresh token").toBe(true);
  });
});
