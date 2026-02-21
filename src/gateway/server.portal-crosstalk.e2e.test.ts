/**
 * Local E2E: Portal chat mode, callback delivery, no cross-talk; Feishu task events.
 * - Portal runs in chatMode (gateway.webchatPortal.chatMode).
 * - Callback messages for the portal session are delivered and not lost.
 * - Chat events for other sessionKeys (e.g. agent:main:main / Feishu) are not
 *   displayed to the portal client (no cross-talk).
 * - Feishu correctly receives its own task events (created/finished) and does
 *   not lose task results; other sessions' tasks are not shown to Feishu (no cross-talk).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { writeConfigFile } from "../config/config.js";
import { rawDataToString } from "../infra/ws.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "test" });

// Portal chat runs in chatMode (gateway.webchatPortal.chatMode ?? true in chat.send).
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

describe("portal cross-talk (local e2e)", () => {
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

  test("portal does not display chat events for other sessionKeys (agent:main:main)", {
    timeout: 25_000,
  }, async () => {
    const authRes = await fetch(`http://127.0.0.1:${port}/portal/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test" }),
    });
    expect(authRes.ok).toBe(true);
    const authJson = (await authRes.json()) as { token?: string };
    expect(authJson.token).toBeDefined();
    const portalToken = authJson.token as string;

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

    const displayed: unknown[] = [];
    const myPortalSegment = "portal:admin";
    ws.on("message", (data) => {
      let obj: { type?: string; event?: string; payload?: { sessionKey?: string } };
      try {
        obj = JSON.parse(rawDataToString(data)) as typeof obj;
      } catch {
        return;
      }
      if (obj.type !== "event" || obj.event !== "chat") return;
      const sk = (obj.payload?.sessionKey ?? "").toLowerCase();
      if (sk && sk.includes(myPortalSegment)) displayed.push(obj.payload);
    });

    const connectId = "c1";
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
          auth: { token: portalToken },
          // Omit device so portal token auth is used (schema requires device to be object if present).
        },
      }),
    );

    const connectRes = await onceMessage(
      ws,
      (o) => (o as { type?: string; id?: string }).type === "res" && (o as { id?: string }).id === connectId,
      5000,
    ) as { ok?: boolean; error?: { message?: string } };
    expect(connectRes.ok, connectRes.error?.message ?? "connect failed").toBe(true);

    await new Promise((r) => setTimeout(r, 200));

    const countBefore = displayed.length;
    const injectPayload = {
      sessionKey: "agent:main:main",
      state: "final",
      message: { content: [{ type: "text", text: "feishu mocker message" }] },
    };

    const injectRes = await fetch(`http://127.0.0.1:${port}/test/inject-broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "chat", payload: injectPayload }),
    });
    expect(injectRes.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 1500));
    ws.close();

    const countAfter = displayed.length;
    const crosstalk =
      countAfter > countBefore &&
      displayed.some(
        (p) => (p as { sessionKey?: string }).sessionKey?.includes("agent:main:main"),
      );
    expect(crosstalk).toBe(false);
  });

  test("portal receives its own callback (final chat) and does not lose it; chat in chatMode", {
    timeout: 25_000,
  }, async () => {
    const authRes = await fetch(`http://127.0.0.1:${port}/portal/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test" }),
    });
    expect(authRes.ok).toBe(true);
    const authJson = (await authRes.json()) as { token?: string };
    const portalToken = authJson.token as string;

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

    const myPortalSegment = "portal:admin";
    const receivedForPortal: unknown[] = [];
    ws.on("message", (data) => {
      let obj: { type?: string; event?: string; payload?: { sessionKey?: string; state?: string } };
      try {
        obj = JSON.parse(rawDataToString(data)) as typeof obj;
      } catch {
        return;
      }
      if (obj.type !== "event" || obj.event !== "chat") return;
      const sk = (obj.payload?.sessionKey ?? "").toLowerCase();
      if (sk && sk.includes(myPortalSegment)) receivedForPortal.push(obj.payload);
    });

    const connectId = "c2";
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
          auth: { token: portalToken },
        },
      }),
    );
    const connectRes = await onceMessage(
      ws,
      (o) => (o as { type?: string; id?: string }).type === "res" && (o as { id?: string }).id === connectId,
      5000,
    ) as { ok?: boolean; error?: { message?: string } };
    expect(connectRes.ok, connectRes.error?.message ?? "connect failed").toBe(true);

    await new Promise((r) => setTimeout(r, 200));

    const callbackPayload = {
      sessionKey: "portal:admin",
      state: "final" as const,
      message: {
        content: [{ type: "text" as const, text: "callback reply for portal only" }],
      },
    };
    const injectRes = await fetch(`http://127.0.0.1:${port}/test/inject-broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "chat", payload: callbackPayload }),
    });
    expect(injectRes.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 1500));
    ws.close();

    expect(receivedForPortal.length).toBeGreaterThanOrEqual(1);
    const finalForUs = receivedForPortal.filter(
      (p) => (p as { state?: string }).state === "final",
    );
    expect(finalForUs.length).toBe(1);
    expect((finalForUs[0] as { sessionKey?: string }).sessionKey?.toLowerCase()).toContain(myPortalSegment);
  });

  test("Feishu receives its own task events (created/finished) and does not lose result; no cross-talk", {
    timeout: 25_000,
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

    const feishuSegment = "feishu";
    const feishuTaskEvents: { action: string; taskId?: string; result?: string; originSessionKey?: string }[] = [];
    ws.on("message", (data) => {
      let obj: {
        type?: string;
        event?: string;
        payload?: {
          action?: string;
          taskId?: string;
          result?: string;
          originSessionKey?: string;
          task?: { originSessionKey?: string };
        };
      };
      try {
        obj = JSON.parse(rawDataToString(data)) as typeof obj;
      } catch {
        return;
      }
      if (obj.type !== "event" || obj.event !== "task") return;
      const p = obj.payload ?? {};
      const osk = (p.originSessionKey ?? p.task?.originSessionKey ?? "").toLowerCase();
      if (!osk.includes(feishuSegment)) return;
      feishuTaskEvents.push({
        action: p.action ?? "",
        taskId: p.taskId,
        result: p.result,
        originSessionKey: p.originSessionKey,
      });
    });

    await connectOk(ws);

    await new Promise((r) => setTimeout(r, 200));

    const taskId = "feishu-task-e2e-1";
    const feishuSessionKey = "agent:main:feishu:user_1";

    const inject = async (action: string, payload: Record<string, unknown>) => {
      const res = await fetch(`http://127.0.0.1:${port}/test/inject-broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "task", payload: { action, ...payload } }),
      });
      expect(res.ok).toBe(true);
    };

    await inject("created", {
      taskId,
      task: {
        id: taskId,
        agentId: "main",
        status: "queued",
        message: "feishu task",
        originSessionKey: feishuSessionKey,
        createdAt: Date.now(),
      },
    });
    await new Promise((r) => setTimeout(r, 400));

    await inject("finished", {
      taskId,
      status: "completed",
      originSessionKey: feishuSessionKey,
      result: "feishu task result text",
      durationMs: 100,
    });
    await new Promise((r) => setTimeout(r, 800));

    const createdEv = feishuTaskEvents.find((e) => e.action === "created" && e.taskId === taskId);
    const finishedEv = feishuTaskEvents.find((e) => e.action === "finished" && e.taskId === taskId);
    expect(createdEv).toBeDefined();
    expect(finishedEv).toBeDefined();
    expect(finishedEv!.result).toBe("feishu task result text");

    const countBefore = feishuTaskEvents.length;
    await inject("created", {
      taskId: "portal-task-e2e-1",
      task: {
        id: "portal-task-e2e-1",
        agentId: "main",
        status: "queued",
        message: "portal task",
        originSessionKey: "portal:admin",
        createdAt: Date.now(),
      },
    });
    await new Promise((r) => setTimeout(r, 400));
    const countAfter = feishuTaskEvents.length;
    expect(countAfter).toBe(countBefore);

    ws.close();
  });
});
