import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
  /**
   * Set when the connection was authenticated via the WebChat Portal.
   * Contains the portal username for per-user session isolation and chatmode enforcement.
   */
  portalUser?: string;
};
