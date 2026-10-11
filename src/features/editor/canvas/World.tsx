"use client";

import { memo, useMemo } from "react";

import { routeEdges, type EdgeGeometry } from "@/core/edges/geometry";
import { nodeMatrix } from "@/core/geometry/basics";
import { nodesInOrder } from "@/core/model/queries";
import type { DEdge, DiagramDoc, DNode, Id, Rect } from "@/core/model/types";
import { getShape, nodeStyle } from "@/core/shapes/registry";

import { useRegistryVersion } from "../packs/use-packs";
import { useDoc, useEditor } from "../store/context";
import { edgeMarkup, nodeMarkup } from "./markup";

interface NodeViewProps {
  node: DNode;
  editing: boolean;
  /** Delay of the draw-in animation, when an agent just created the node. */
  reveal: number | undefined;
  /** Shape registry version: an imported icon pack arriving or leaving redraws the node. */
  shapes: number;
}

const NodeView = memo(function NodeView({ node, editing, reveal }: NodeViewProps) {
  const opacity = nodeStyle(node).opacity;
  return (
    <g
      data-id={node.id}
      data-editing={editing || undefined}
      transform={`matrix(${nodeMatrix(node).join(" ")})`}
      opacity={opacity < 1 ? opacity : undefined}
    >
      <g
        className={reveal !== undefined ? "reveal" : undefined}
        style={reveal !== undefined ? { animationDelay: `${reveal}ms` } : undefined}
        dangerouslySetInnerHTML={{ __html: nodeMarkup(node) }}
      />
    </g>
  );
});

interface EdgeViewProps {
  id: Id;
  markup: string;
  opacity: number;
  reveal: number | undefined;
  /** Label groups hide their text while it is being edited. */
  editing?: boolean;
}

const EdgeView = memo(function EdgeView({ id, markup, opacity, reveal, editing }: EdgeViewProps) {
  return (
    <g
      data-id={id}
      data-editing={editing || undefined}
      opacity={opacity < 1 ? opacity : undefined}
      className={reveal !== undefined ? "reveal-line" : undefined}
      style={reveal !== undefined ? { animationDelay: `${reveal}ms` } : undefined}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});

/** While a layout animates, nodes use tweened rectangles and connectors re-route freely. */
function displayDoc(doc: DiagramDoc, tween: Record<Id, Rect> | null): Pick<DiagramDoc, "nodes" | "edges" | "settings"> {
  if (!tween) return doc;
  const nodes: Record<Id, DNode> = {};
  for (const node of Object.values(doc.nodes)) nodes[node.id] = tween[node.id] ? { ...node, ...tween[node.id] } : node;
  const edges: Record<Id, DEdge> = {};
  for (const edge of Object.values(doc.edges)) {
    const moving = (edge.from.node && tween[edge.from.node]) || (edge.to.node && tween[edge.to.node]);
    edges[edge.id] = moving && edge.autoRoute ? { ...edge, waypoints: undefined, from: { node: edge.from.node }, to: { node: edge.to.node } } : edge;
  }
  return { nodes, edges, settings: doc.settings };
}

/** Shared by the overlay so selection outlines follow the same geometry. */
export function useDisplay(): { nodes: Record<Id, DNode>; edges: Record<Id, DEdge>; routes: Map<Id, EdgeGeometry> } {
  const doc = useDoc();
  const tween = useEditor((state) => state.tween);
  const shapes = useRegistryVersion();
  return useMemo(() => {
    const display = displayDoc(doc, tween);
    return { nodes: display.nodes, edges: display.edges, routes: routeEdges(display) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only nodes and edges affect geometry
  }, [doc.nodes, doc.edges, doc.settings.layout.direction, tween, shapes]);
}

/**
 * The diagram itself, in world coordinates. Paint order matches the exporters:
 * containers → connectors → nodes → raised connectors → connector labels.
 */
export function World({ display }: { display: ReturnType<typeof useDisplay> }) {
  const background = useEditor((state) => state.doc!.settings.background);
  const editing = useEditor((state) => state.editing);
  const reveal = useEditor((state) => state.reveal);
  const shapes = useRegistryVersion();

  const { containers, regular } = useMemo(() => {
    const containers: DNode[] = [];
    const regular: DNode[] = [];
    for (const node of nodesInOrder(display.nodes)) (getShape(node.shape).container ? containers : regular).push(node);
    return { containers, regular };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shapes` changes when an icon pack is added or removed (a shape may become a container)
  }, [display.nodes, shapes]);

  const edges = useMemo(() => {
    const sorted = Object.values(display.edges).sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : 1));
    return sorted.flatMap((edge) => {
      const geometry = display.routes.get(edge.id);
      return geometry ? [{ edge, markup: edgeMarkup(edge, geometry, background) }] : [];
    });
  }, [display.edges, display.routes, background]);

  const renderNode = (node: DNode) => <NodeView key={node.id} node={node} editing={editing === node.id} reveal={reveal[node.id]} shapes={shapes} />;
  const renderEdge = ({ edge, markup }: (typeof edges)[number]) => (
    <EdgeView key={edge.id} id={edge.id} markup={markup.line} opacity={edge.style?.opacity ?? 1} reveal={reveal[edge.id]} />
  );

  return (
    <>
      <g>{containers.map(renderNode)}</g>
      <g>{edges.filter(({ edge }) => (edge.z ?? 0) <= 0).map(renderEdge)}</g>
      <g>{regular.map(renderNode)}</g>
      <g>{edges.filter(({ edge }) => (edge.z ?? 0) > 0).map(renderEdge)}</g>
      <g>
        {edges.map(({ edge, markup }) =>
          markup.labels ? (
            <EdgeView
              key={edge.id}
              id={edge.id}
              markup={markup.labels}
              opacity={edge.style?.opacity ?? 1}
              reveal={reveal[edge.id]}
              editing={editing === edge.id}
            />
          ) : null,
        )}
      </g>
    </>
  );
}
