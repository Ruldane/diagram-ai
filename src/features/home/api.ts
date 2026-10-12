import type { DiagramDoc, DiagramSummary } from "@/core/model/types";
import type { DiagramAccess } from "@/core/auth";
import type { ApiError, CreateDiagramRequest, DiagramResponse, ListDiagramsResponse } from "@/core/protocol";

export type ImportFormat = "json" | "drawio" | "mermaid";

export interface ImportRequest {
  format: ImportFormat;
  content: string;
  name?: string;
}

export interface ImportResponse {
  diagram: DiagramDoc;
  warnings: string[];
}

/** JSON request against the REST API. Rejects with the server's `{ error }` message. */
async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...rest,
      ...(json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Could not reach the server. Is it still running?");
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 && typeof window !== "undefined") {
    // Accounts on and the session ended (or never existed): the sign-in page, then back here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load drops everything the previous session left in memory
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? (body as ApiError).error : null;
    throw new Error(typeof message === "string" && message ? message : `Request failed (${response.status}).`);
  }
  return body as T;
}

export const errorMessage = (error: unknown): string => (error instanceof Error && error.message ? error.message : "Something went wrong.");

/** Accounts on: the caller’s role on each diagram of the latest list. Empty in solo mode. */
let latestAccess: Record<string, DiagramAccess> = {};
export const getDiagramAccess = (): Record<string, DiagramAccess> => latestAccess;

export async function listDiagrams(signal?: AbortSignal): Promise<DiagramSummary[]> {
  const response = await request<ListDiagramsResponse>("/api/diagrams", { signal });
  latestAccess = response.access ?? {};
  return response.diagrams;
}

export async function createDiagram(input: CreateDiagramRequest): Promise<DiagramDoc> {
  return (await request<DiagramResponse>("/api/diagrams", { method: "POST", json: input })).diagram;
}

export async function duplicateDiagram(id: string): Promise<DiagramDoc> {
  return (await request<DiagramResponse>(`/api/diagrams/${encodeURIComponent(id)}/duplicate`, { method: "POST" })).diagram;
}

export async function deleteDiagram(id: string): Promise<void> {
  await request<unknown>(`/api/diagrams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function importDiagram(input: ImportRequest): Promise<ImportResponse> {
  return request<ImportResponse>("/api/import", { method: "POST", json: input });
}

/** The version is part of the URL so the browser can cache each revision. */
export const thumbnailUrl = (diagram: Pick<DiagramSummary, "id" | "version">): string =>
  `/api/diagrams/${encodeURIComponent(diagram.id)}/thumbnail?v=${diagram.version}`;

export const diagramHref = (id: string): string => `/d/${encodeURIComponent(id)}`;
