import { atLeast, type Role } from "@/core/auth";
import type { Actor, DiagramDoc, DiagramSummary } from "@/core/model/types";

import { forbidden, notFound } from "../errors";
import type { Hub } from "../realtime/hub";
import type { DiagramService } from "../service";
import type { Access } from "./access";
import { attributePatch } from "./attribution";

/**
 * Authorization at the adapters. With accounts on REST routes, the SSE route, the
 * MCP endpoint and the in-app assistant receive a `DiagramService` and a `Hub`
 * wrapped here, so a tool or a route cannot reach a diagram its caller may not
 * use by forgetting a check: the wrapper is the check.
 *
 * Every public member of `DiagramService` must have an entry below. The type
 * is exhaustive, so adding a method fails the build until its rule is written,
 * and anything not listed does not exist on the wrapper (default deny).
 */

type Method = Exclude<keyof DiagramService, "hub">;

/** What a method needs: a role on the diagram named by argument `id` (usually the first), or custom handling. */
type Rule = { role: Role } | { special: "list" | "create" | "duplicate" | "import" | "commit" | "presence" };

const RULES: Record<Method, Rule> = {
  list: { special: "list" },
  get: { role: "viewer" },
  create: { special: "create" },
  duplicate: { special: "duplicate" },
  importDiagram: { special: "import" },
  deleteDiagram: { role: "owner" },
  commit: { special: "commit" },
  applyElements: { role: "editor" },
  buildSequence: { role: "editor" },
  previewLayout: { role: "viewer" },
  layout: { role: "editor" },
  remove: { role: "editor" },
  addComment: { role: "editor" },
  replyToComment: { role: "editor" },
  resolveComment: { role: "editor" },
  listSnapshots: { role: "viewer" },
  createSnapshot: { role: "editor" },
  getSnapshot: { role: "viewer" },
  restoreSnapshot: { role: "editor" },
  reviewState: { role: "viewer" },
  acceptReview: { role: "editor" },
  reviewStatus: { role: "viewer" },
  export: { role: "viewer" },
  preview: { role: "viewer" },
  setPresence: { special: "presence" },
};

/** Exposed for tests: the method names the wrapper knows. */
export const GUARDED_METHODS = Object.keys(RULES) as Method[];

const isActor = (value: unknown): value is Actor =>
  typeof value === "object" && value !== null && typeof (value as Actor).kind === "string" && typeof (value as Actor).id === "string" && typeof (value as Actor).name === "string";

/** Replaces any actor in the arguments (directly, or as `options.actor`) with the one the caller is entitled to. */
function withTrustedActors(args: unknown[], access: Access): unknown[] {
  return args.map((arg) => {
    if (isActor(arg)) return access.actor(arg);
    if (typeof arg === "object" && arg !== null && isActor((arg as { actor?: unknown }).actor)) return { ...arg, actor: access.actor((arg as { actor: Actor }).actor) };
    return arg;
  });
}

export interface GuardOptions {
  /** Waits until a new diagram's row is stored, so ownership can be recorded against it. */
  settle: () => Promise<void>;
  /** Records the caller as the owner of a stored diagram. Returns false when there is no such row. */
  claim: (diagramId: string, userId: string) => Promise<boolean>;
}

export function guardService(service: DiagramService, access: Access, options: GuardOptions): DiagramService {
  const hub = guardHub(service.hub, access);

  /** Makes the caller the owner of a diagram this call created, or removes the diagram if that cannot be recorded. */
  async function own(doc: DiagramDoc): Promise<void> {
    const user = access.user;
    if (!user) return;
    try {
      await options.settle();
      if (!(await options.claim(doc.id, user.id))) throw new Error("the diagram row was not found");
    } catch (error) {
      await service.deleteDiagram(doc.id).catch(() => undefined);
      console.error("[diagram-ai] Could not record the owner of a new diagram; it was removed:", error);
      throw new Error("The diagram could not be created. Try again.");
    }
    access.grantLocally(doc.id, "owner");
  }

  const run = async (method: Method, rule: Rule, args: unknown[]): Promise<unknown> => {
    const target = service as unknown as Record<string, (...a: unknown[]) => unknown>;
    const call = (...a: unknown[]) => Reflect.apply(target[method], service, a) as Promise<unknown>;

    if ("role" in rule) {
      await access.require(String(args[0]), rule.role);
      return call(...withTrustedActors(args, access));
    }

    switch (rule.special) {
      case "list": {
        const visible = await access.preload();
        return ((await call()) as DiagramSummary[]).filter((summary) => visible.has(summary.id));
      }
      case "create":
      case "import": {
        if (access.principal.token?.scope === "read") throw forbidden("This access token is read-only.");
        const result = (await call(...withTrustedActors(args, access))) as DiagramDoc | { doc: DiagramDoc };
        await own("doc" in result ? result.doc : result);
        return result;
      }
      case "duplicate": {
        await access.require(String(args[0]), "viewer");
        if (access.principal.token?.scope === "read") throw forbidden("This access token is read-only.");
        const copy = (await call(...withTrustedActors(args, access))) as DiagramDoc;
        await own(copy);
        return copy;
      }
      case "commit": {
        const id = String(args[0]);
        await access.require(id, "editor");
        const [, patch, actor, ...rest] = withTrustedActors(args, access) as [string, Parameters<typeof attributePatch>[1], Actor, ...unknown[]];
        const trusted = access.local ? patch : attributePatch(await service.get(id), patch, actor);
        return call(id, trusted, actor, ...rest);
      }
      case "presence": {
        throw new Error("unreachable: presence is synchronous");
      }
    }
  };

  const methods = new Map<string, (...args: unknown[]) => unknown>();
  for (const method of GUARDED_METHODS) {
    const rule = RULES[method];
    if ("special" in rule && rule.special === "presence") {
      // Synchronous like the method it wraps, so a caller that does not await cannot leave a rejection behind.
      methods.set(method, (...args) => {
        const id = String(args[0]);
        if (!atLeast(access.cached(id), "viewer")) throw notFound(`No diagram with id "${id}".`);
        return Reflect.apply((service as unknown as Record<string, (...a: unknown[]) => unknown>)[method], service, args);
      });
    } else {
      methods.set(method, (...args) => run(method, rule, args));
    }
  }

  return new Proxy(service, {
    get(_target, property) {
      if (property === "hub") return hub;
      if (typeof property === "string") return methods.get(property);
      return undefined;
    },
    has: (_target, property) => property === "hub" || (typeof property === "string" && methods.has(property)),
  });
}

/**
 * The hub as a caller may use it. Per-diagram methods work only for diagrams
 * the caller is known to be able to open (the role was looked up earlier in
 * this request, or preloaded for the MCP endpoint); workspace-wide ones are
 * not available.
 */
export function guardHub(hub: Hub, access: Access): Hub {
  const allowed = (id: string | undefined): id is string => id !== undefined && atLeast(access.cached(id), "viewer");
  const need = (id: string): void => {
    if (!allowed(id)) throw notFound(`No diagram with id "${id}".`);
  };

  const overrides: Record<string, (...args: never[]) => unknown> = {
    subscribe: (id: string, listener: Parameters<Hub["subscribe"]>[1]) => (need(id), hub.subscribe(id, listener)),
    publish: (id: string, event: Parameters<Hub["publish"]>[1]) => (need(id), hub.publish(id, event)),
    log: (id: string, actor: Actor, action: Parameters<Hub["log"]>[2], summary: string, ids?: string[]) => (need(id), hub.log(id, actor, action, summary, ids)),
    viewers: (id: string) => (need(id), hub.viewers(id)),
    recentActivity: (id: string) => (need(id), hub.recentActivity(id)),
    latestPresence: (id: string) => (need(id), hub.latestPresence(id)),
    setPresence: (id: string, presence: Parameters<Hub["setPresence"]>[1]) => (need(id), hub.setPresence(id, presence)),
    clearPresence: (id: string, clientId: string) => (need(id), hub.clearPresence(id, clientId)),
    listPeers: (id: string) => (need(id), hub.listPeers(id)),
    setPeer: (id: string, input: Parameters<Hub["setPeer"]>[1], owner?: string) => (need(id), hub.setPeer(id, input, owner)),
    removePeer: (id: string, peerId: string) => (need(id), hub.removePeer(id, peerId)),
    nextTabName: (id: string) => (need(id), hub.nextTabName(id)),
    // An agent calling a tool on a diagram it may not use must not show up on that diagram.
    touchAgent: (actor: Actor, tool: string, id?: string) => hub.touchAgent(actor, tool, allowed(id) ? id : undefined),
    listAgents: (id?: string) => {
      if (id !== undefined) return allowed(id) ? hub.listAgents(id) : [];
      return hub.listAgents().filter((agent) => agent.ownerId === access.user?.id || allowed(agent.diagramId));
    },
  };

  return new Proxy(hub, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      const override = overrides[property];
      return override ?? undefined;
    },
  });
}
