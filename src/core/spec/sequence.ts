import { edgeKindStyle } from "../edges/kinds";
import { newId, slugify } from "../model/ids";
import type { Actor, DEdge, DNode, Id, Patch, Point } from "../model/types";
import { measureText } from "../text/measure";

/**
 * Sequence diagrams are not node-link layouts: time flows down and every
 * message sits on its own row. This builder turns a plain list of
 * participants and messages into positioned lifelines and message connectors.
 */

export type MessageKind = "sync" | "async" | "return";

export interface SequenceParticipant {
  id?: string;
  name: string;
  /** `actor` draws a stick figure header. */
  kind?: "participant" | "actor";
  color?: { fill: string; stroke: string; text: string };
}

export interface SequenceMessage {
  from: string;
  to: string;
  text?: string;
  kind?: MessageKind;
}

export interface SequenceSpec {
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
}

export interface SequenceResult {
  patch: Patch;
  participantIds: Id[];
  warnings: string[];
}

const HEADER = 40;
const ACTOR_HEADER = 64;
const LIFELINE_W = 140;
const MIN_GAP = 200;
const FIRST_ROW = 44;
const ROW = 46;
const SELF_LOOP = 44;
const LABEL_FONT = { family: "sans", size: 12 } as const;

const KIND_STYLE: Record<MessageKind, ReturnType<typeof edgeKindStyle>> = {
  sync: edgeKindStyle("message"),
  async: edgeKindStyle("async"),
  return: edgeKindStyle("return"),
};

export function buildSequence(spec: SequenceSpec, origin: Point = { x: 0, y: 0 }, actor?: Actor): SequenceResult {
  const warnings: string[] = [];
  const ids = new Map<string, Id>();
  const taken = new Set<Id>();

  const participants = spec.participants.map((participant) => {
    let id = slugify(participant.id ?? participant.name) || newId("node");
    for (let i = 2; taken.has(id); i++) id = `${slugify(participant.id ?? participant.name)}-${i}`;
    taken.add(id);
    // Messages may refer to a participant by id or by display name.
    ids.set(participant.id ?? participant.name, id);
    ids.set(participant.name, id);
    ids.set(id, id);
    return { ...participant, id };
  });
  const indexOf = new Map(participants.map((p, i) => [p.id, i]));

  const messages = spec.messages.flatMap((message, index) => {
    const from = ids.get(message.from);
    const to = ids.get(message.to);
    if (!from || !to) {
      warnings.push(`messages[${index}]: unknown participant "${!from ? message.from : message.to}". Declare it in participants first.`);
      return [];
    }
    return [{ ...message, from, to }];
  });

  // Space neighbouring lifelines so the widest label between them fits.
  const gaps = participants.slice(1).map(() => MIN_GAP);
  for (const message of messages) {
    const a = indexOf.get(message.from)!;
    const b = indexOf.get(message.to)!;
    if (a === b) continue;
    const span = Math.abs(a - b);
    const needed = (measureText(message.text ?? "", LABEL_FONT) + 56) / span;
    for (let i = Math.min(a, b); i < Math.max(a, b); i++) gaps[i] = Math.max(gaps[i], needed);
  }
  const headerHeight = participants.some((p) => p.kind === "actor") ? ACTOR_HEADER : HEADER;
  const height = headerHeight + FIRST_ROW + Math.max(1, messages.length) * ROW;

  const nodes: DNode[] = [];
  let x = origin.x;
  participants.forEach((participant, index) => {
    nodes.push({
      id: participant.id,
      shape: participant.kind === "actor" ? "uml/actor-lifeline" : "uml/lifeline",
      x: Math.round(x),
      y: origin.y,
      w: LIFELINE_W,
      h: height,
      z: index + 1,
      text: participant.name,
      data: { header: headerHeight },
      ...(participant.color
        ? { style: { fill: participant.color.fill, stroke: participant.color.stroke, textColor: participant.color.text } }
        : {}),
      createdBy: actor,
    });
    x += gaps[index] ?? 0;
  });

  const centreX = new Map(nodes.map((n) => [n.id, n.x + n.w / 2]));
  const edges: DEdge[] = messages.map((message, index) => {
    const y = origin.y + headerHeight + FIRST_ROW + index * ROW;
    const relative = (y - origin.y) / height;
    const base = {
      id: newId("edge"),
      text: message.text,
      style: KIND_STYLE[message.kind ?? "sync"],
      createdBy: actor,
    };
    if (message.from === message.to) {
      const cx = centreX.get(message.from)!;
      const down = Math.min(ROW * 0.5, 22);
      return {
        ...base,
        from: { node: message.from, anchor: { x: 0.5, y: relative } },
        to: { node: message.to, anchor: { x: 0.5, y: (y + down - origin.y) / height } },
        routing: "orthogonal",
        waypoints: [
          { x: cx + SELF_LOOP, y },
          { x: cx + SELF_LOOP, y: y + down },
        ],
      };
    }
    return {
      ...base,
      from: { node: message.from, anchor: { x: 0.5, y: relative } },
      to: { node: message.to, anchor: { x: 0.5, y: relative } },
      routing: "straight",
    };
  });

  return { patch: { nodes: { set: nodes }, edges: { set: edges } }, participantIds: nodes.map((n) => n.id), warnings };
}
