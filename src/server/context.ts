import { DATA_DIR, databaseUrl } from "./config";
import { Database, describeDatabase } from "./db/database";
import { createHubState, Hub, type HubState } from "./realtime/hub";
import { createServiceState, DiagramService, type ServiceState } from "./service";
import { createPostgresState, PostgresRepository, type PostgresState } from "./store/postgres";
import { createRepositoryState, FileRepository, type DiagramRepository, type RepositoryState } from "./store/repository";

interface ServerState {
  hub: HubState;
  repository: RepositoryState;
  postgres: PostgresState;
  service: ServiceState;
}

interface ServerContext {
  hub: Hub;
  service: DiagramService;
}

/**
 * Process-wide state lives on `globalThis`; the classes that operate on it
 * are created fresh on every call.
 *
 * Why not a plain singleton? The dev server compiles each route separately and
 * hot-reloads modules, so a module-level instance would be duplicated per
 * route — and an instance cached on `globalThis` would keep running the code
 * it was created with, ignoring later edits. Keeping only plain data global
 * gives one shared state and always-current behaviour.
 */
const globalRef = globalThis as typeof globalThis & { __diagramAiState?: ServerState };

function getState(): ServerState {
  if (!globalRef.__diagramAiState) {
    globalRef.__diagramAiState = { hub: createHubState(), repository: createRepositoryState(), postgres: createPostgresState(), service: createServiceState() };
    const url = databaseUrl();
    console.info(`[diagram-ai] Storage: ${url ? `PostgreSQL at ${describeDatabase(url)}` : `JSON files in ${DATA_DIR}`}`);
  }
  const state = globalRef.__diagramAiState;
  // A state object created before this field existed (dev server hot reload) lacks it.
  state.postgres ??= createPostgresState();
  return state;
}

/** The one place that decides where diagrams are stored: PostgreSQL when `DATABASE_URL` is set, JSON files otherwise. */
function createRepository(state: ServerState): DiagramRepository {
  return databaseUrl() ? new PostgresRepository(state.postgres) : new FileRepository(state.repository);
}

export function getContext(): ServerContext {
  const state = getState();
  const hub = new Hub(state.hub);
  return { hub, service: new DiagramService(createRepository(state), hub, state.service) };
}

/** The database connection, or null when running on JSON files. */
export function getDatabase(): Database | null {
  return databaseUrl() ? new Database(getState().postgres.database) : null;
}

export const getService = (): DiagramService => getContext().service;
export const getHub = (): Hub => getContext().hub;
