import type { DiagramDoc, Id } from "../model/types";
import type { ReviewInfo } from "../protocol";

/** `GET /api/diagrams/[id]/review`, and the answer to accepting. */
export interface ReviewResponse {
  review: ReviewInfo;
  /** The baseline to compare the diagram with; `null` when nothing is pending. */
  base: DiagramDoc | null;
}

/** `POST /api/diagrams/[id]/review` */
export interface AcceptReviewRequest {
  action: "accept";
  /** Elements to accept. Omitted or `"all"` accepts everything. */
  ids?: Id[] | "all";
}

/** `GET /api/diagrams/[id]/snapshots/[snapshotId]` */
export interface SnapshotResponse {
  snapshot: { id: Id; name: string; createdAt: string; doc: DiagramDoc };
}
