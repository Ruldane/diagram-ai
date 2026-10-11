import type { Actor, DiagramSummary } from "@/core/model/types";
import type { SnapshotInfo } from "@/core/protocol";

/** Columns `list()` reads: everything a summary needs, and never the document. */
export const SUMMARY_COLUMNS = "id, name, type, description, node_count, edge_count, open_comments, version, created_at, updated_at";

export interface SummaryRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  node_count: number;
  edge_count: number;
  open_comments: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export function toDiagramSummary(row: SummaryRow): DiagramSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    ...(row.description === null ? {} : { description: row.description }),
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    openComments: row.open_comments,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

export interface SnapshotRow {
  id: string;
  name: string;
  author: Actor;
  node_count: number;
  edge_count: number;
  created_at: Date;
}

export function toSnapshotInfo(row: SnapshotRow): SnapshotInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    author: row.author,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
  };
}

export const newestFirst = (a: DiagramSummary, b: DiagramSummary): number => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1);
