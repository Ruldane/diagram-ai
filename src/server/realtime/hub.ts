import { randomId } from "@/core/model/ids";
import type { Actor, Id } from "@/core/model/types";
import type { ActivityAction, ActivityEntry, AgentInfo, ClientPresence, DiagramEvent, WorkspaceEvent } from "@/core/protocol";

import { ACTIVITY_LIMIT, AGENT_WORKING_MS } from "../config";

type Listener<E> = (event: E) => void;

const PRESENCE_TTL_MS = 5 * 60_000;
const AGENT_TTL_MS = 30 * 60_000;

/**
 * In-process pub/sub plus the ephemeral state that never touches disk:
 * who is watching, which agents are active and what they did recently.
 *
 * A single Node process is assumed (local `next dev` / `next start`). To scale
 * out, back this class with Redis pub/sub and keep its interface.
 */
export interface HubState {
  diagramListeners: Map<Id, Set<Listener<DiagramEvent>>>;
  workspaceListeners: Set<Listener<WorkspaceEvent>>;
  activity: Map<Id, ActivityEntry[]>;
  presence: Map<Id, Map<string, ClientPresence>>;
  agents: Map<string, AgentInfo>;
  idleTimers: Map<string, NodeJS.Timeout>;
}

export const createHubState = (): HubState => ({
  diagramListeners: new Map(),
  workspaceListeners: new Set(),
  activity: new Map(),
  presence: new Map(),
  agents: new Map(),
  idleTimers: new Map(),
});

export class Hub {
  private readonly diagramListeners: HubState["diagramListeners"];
  private readonly workspaceListeners: HubState["workspaceListeners"];
  private readonly activity: HubState["activity"];
  private readonly presence: HubState["presence"];
  private readonly agents: HubState["agents"];
  private readonly idleTimers: HubState["idleTimers"];

  /** State is passed in so it can outlive this instance (see `server/context.ts`). */
  constructor(state: HubState = createHubState()) {
    this.diagramListeners = state.diagramListeners;
    this.workspaceListeners = state.workspaceListeners;
    this.activity = state.activity;
    this.presence = state.presence;
    this.agents = state.agents;
    this.idleTimers = state.idleTimers;
  }

  /* ------------------------------------------------------------ pub/sub */

  subscribe(diagramId: Id, listener: Listener<DiagramEvent>): () => void {
    let listeners = this.diagramListeners.get(diagramId);
    if (!listeners) this.diagramListeners.set(diagramId, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.diagramListeners.delete(diagramId);
    };
  }

  publish(diagramId: Id, event: DiagramEvent): void {
    for (const listener of this.diagramListeners.get(diagramId) ?? []) listener(event);
  }

  subscribeWorkspace(listener: Listener<WorkspaceEvent>): () => void {
    this.workspaceListeners.add(listener);
    return () => this.workspaceListeners.delete(listener);
  }

  publishWorkspace(event: WorkspaceEvent): void {
    for (const listener of this.workspaceListeners) listener(event);
  }

  /** Number of browser tabs currently watching a diagram. */
  viewers(diagramId: Id): number {
    return this.diagramListeners.get(diagramId)?.size ?? 0;
  }

  /* ----------------------------------------------------------- activity */

  log(diagramId: Id, actor: Actor, action: ActivityAction, summary: string, ids?: Id[]): ActivityEntry {
    const entry: ActivityEntry = {
      id: randomId("a"),
      at: new Date().toISOString(),
      actor,
      action,
      summary,
      ...(ids?.length ? { ids: ids.slice(0, 50) } : {}),
    };
    const list = this.activity.get(diagramId) ?? [];
    list.push(entry);
    if (list.length > ACTIVITY_LIMIT) list.splice(0, list.length - ACTIVITY_LIMIT);
    this.activity.set(diagramId, list);
    this.publish(diagramId, { type: "activity", entry });
    return entry;
  }

  recentActivity(diagramId: Id): ActivityEntry[] {
    return this.activity.get(diagramId) ?? [];
  }

  forget(diagramId: Id): void {
    this.activity.delete(diagramId);
    this.presence.delete(diagramId);
  }

  /* ----------------------------------------------------------- presence */

  setPresence(diagramId: Id, presence: ClientPresence): void {
    let clients = this.presence.get(diagramId);
    if (!clients) this.presence.set(diagramId, (clients = new Map()));
    clients.set(presence.clientId, presence);
  }

  clearPresence(diagramId: Id, clientId: string): void {
    this.presence.get(diagramId)?.delete(clientId);
  }

  /** Presence of the most recently active browser tab on a diagram. */
  latestPresence(diagramId: Id): ClientPresence | null {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    let latest: ClientPresence | null = null;
    for (const presence of this.presence.get(diagramId)?.values() ?? []) {
      if (Date.parse(presence.at) < cutoff) continue;
      if (!latest || presence.at > latest.at) latest = presence;
    }
    return latest;
  }

  /* ------------------------------------------------------------- agents */

  /** Records that an agent just ran a tool; it shows as "working" for a few seconds. */
  touchAgent(actor: Actor, tool: string, diagramId?: Id): AgentInfo {
    const previous = this.agents.get(actor.id);
    const agent: AgentInfo = {
      id: actor.id,
      name: actor.name,
      status: "working",
      lastSeen: new Date().toISOString(),
      diagramId: diagramId ?? previous?.diagramId,
      tool,
    };
    this.agents.set(actor.id, agent);
    this.broadcastAgent(agent);

    clearTimeout(this.idleTimers.get(actor.id));
    this.idleTimers.set(
      actor.id,
      setTimeout(() => {
        const current = this.agents.get(actor.id);
        if (!current) return;
        const idle: AgentInfo = { ...current, status: "idle" };
        this.agents.set(actor.id, idle);
        this.broadcastAgent(idle);
      }, AGENT_WORKING_MS),
    );
    return agent;
  }

  private broadcastAgent(agent: AgentInfo): void {
    this.publishWorkspace({ type: "agent", agent });
    if (agent.diagramId) this.publish(agent.diagramId, { type: "agent", agent });
  }

  /** Agents seen recently, optionally only those that touched a given diagram. */
  listAgents(diagramId?: Id): AgentInfo[] {
    const cutoff = Date.now() - AGENT_TTL_MS;
    return [...this.agents.values()].filter(
      (agent) => Date.parse(agent.lastSeen) >= cutoff && (!diagramId || agent.diagramId === diagramId),
    );
  }
}
