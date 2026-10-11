import { BRIDGE_ACK_HEADER, bridgeAck } from "@/core/chat-terms";
import type { ChatEngineId } from "@/core/protocol";

import { databaseUrl } from "../../config";
import { ServiceError } from "../../errors";

/** Hosts a browser on this machine uses to reach the app. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `localhost:3000` → `localhost`, `[::1]:3000` → `[::1]`. */
function hostnameOf(hostHeader: string | null): string | null {
  const value = hostHeader?.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(0, end + 1) : null;
  }
  return value.split(":")[0] ?? null;
}

const LOOPBACK_ADDRESS = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/** Every address in a comma-separated forwarding header is this machine. */
function allLoopback(header: string): boolean {
  const entries = header.split(",").map((entry) => entry.trim().replace(/^\[|\]$/g, "")).filter(Boolean);
  return entries.length > 0 && entries.every((entry) => LOOPBACK_ADDRESS.test(entry));
}

export interface BridgeEnvironment {
  /** Value of `DIAGRAM_AI_LOCAL_AGENTS`. */
  switch?: string;
  /** Accounts and sharing are on, so the person at the keyboard is not the only one who can reach the app. */
  multiUser: boolean;
}

export function currentBridgeEnvironment(): BridgeEnvironment {
  return { switch: process.env.DIAGRAM_AI_LOCAL_AGENTS, multiUser: Boolean(databaseUrl()) };
}

/**
 * Why local CLI engines are off for this deployment, or `null` when they may
 * run. `DIAGRAM_AI_LOCAL_AGENTS=on` is accepted but is not an override:
 * nothing re-enables the bridge in multi-user mode.
 */
export function bridgeDisabledReason(environment: BridgeEnvironment = currentBridgeEnvironment()): string | null {
  if (environment.switch?.trim().toLowerCase() === "off") return "Turned off with DIAGRAM_AI_LOCAL_AGENTS=off.";
  if (environment.multiUser) return "Not available when accounts and sharing are enabled: your CLI login is for your own use on your own computer.";
  return null;
}

/**
 * The request must come from a browser on this machine, addressed to the
 * loopback name, and must not have passed through a proxy. This keeps the
 * bridge from letting someone else on a network drive the CLI that is logged
 * in as this person.
 */
export function assertLocalRequest(request: Request, environment: BridgeEnvironment = currentBridgeEnvironment()): void {
  const disabled = bridgeDisabledReason(environment);
  if (disabled) throw new ServiceError("forbidden", `Local agents are unavailable. ${disabled}`);

  const host = hostnameOf(request.headers.get("host") ?? new URL(request.url).host);
  // Next's own dev proxy adds x-forwarded-host (equal to Host) and x-forwarded-for (the client's address, appended
  // to anything the client sent). So those are fine when they name this machine; a forged or real remote address is not.
  const forwardedHost = hostnameOf(request.headers.get("x-forwarded-host"));
  const addresses = [request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")].filter((value): value is string => value !== null);
  const proxied = (forwardedHost !== null && forwardedHost !== host) || request.headers.has("forwarded") || !addresses.every(allLoopback);
  if (!host || !LOOPBACK_HOSTS.has(host) || proxied) {
    throw new ServiceError(
      "forbidden",
      "Local agents only work when this app is opened at http://localhost or http://127.0.0.1 on the same computer. They are not available over a network or through a proxy.",
    );
  }
}

/** The person agreed to the current wording for this engine (the dialog sets the header). */
export function assertAcknowledged(request: Request, engine: ChatEngineId): void {
  if (request.headers.get(BRIDGE_ACK_HEADER) !== bridgeAck(engine)) {
    throw new ServiceError("forbidden", "Using a local agent needs your confirmation first. Open the Ask panel and accept the notice for it.");
  }
}
