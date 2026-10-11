import type { DiagramDoc, DiagramSummary } from "@/core/model/types";
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
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? (body as ApiError).error : null;
    throw new Error(typeof message === "string" && message ? message : `Request failed (${response.status}).`);
  }
  return body as T;
}

export const errorMessage = (error: unknown): string => (error instanceof Error && error.message ? error.message : "Something went wrong.");

export async function listDiagrams(signal?: AbortSignal): Promise<DiagramSummary[]> {
  return (await request<ListDiagramsResponse>("/api/diagrams", { signal })).diagrams;
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
