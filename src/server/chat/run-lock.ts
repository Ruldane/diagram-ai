import type { Id } from "@/core/model/types";

import { ServiceError } from "../errors";

/**
 * Diagrams with an assistant run in progress. On `globalThis` for the same
 * reason as the rest of the server state: the dev server compiles each route
 * separately, so a module-level set would not be shared.
 */
const globalRef = globalThis as typeof globalThis & { __diagramAiChatRuns?: Set<Id> };

const running = (): Set<Id> => (globalRef.__diagramAiChatRuns ??= new Set<Id>());

/**
 * One run per diagram: two assistants editing the same canvas from different
 * prompts would trample each other. Returns the function that ends the claim.
 */
export function claimChatRun(diagramId: Id): () => void {
  const claims = running();
  if (claims.has(diagramId)) {
    throw new ServiceError("conflict", "The assistant is already working on this diagram. Wait for it to finish, or stop it first.");
  }
  claims.add(diagramId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims.delete(diagramId);
  };
}
