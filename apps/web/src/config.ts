// ── Persistence keys ──────────────────────────────────────────────────────────

export const CURRENT_QUERY_KEY = "sparql-studio:currentQuery";
export const ACTIVE_QUERY_KEY = "sparql-studio:activeQueryId";
export const EXCLUDED_GRAPHS_KEY = "sparql-studio:excludedGraphs";
export const PREFIX_ON_KEY = "sparql-studio:prefixesOn";

// ── Default values ────────────────────────────────────────────────────────────

export const DEFAULT_QUERY = "SELECT * WHERE { ?s ?p ?o } LIMIT 25";

// ── Result limits ─────────────────────────────────────────────────────────────

/** Max rows persisted to IndexedDB per query result (prevents IDB bloat). */
export const IDB_RESULT_ROW_CAP = 5_000;

/** Max rows shown in the results table. */
export const DISPLAY_CAP = 10_000;

/** Max rows shown in JSON view. */
export const JSON_CAP = 1_000;

/** Max triples fetched per direction on the Subject page. */
export const SUBJECT_LIMIT = 2000;

/** Max named graphs fetched on the Graph Explorer list view. */
export const GRAPH_LIST_LIMIT = 1000;

/** Max types fetched on the Graph Explorer detail view. */
export const TYPES_LIMIT = 500;

// ── History ───────────────────────────────────────────────────────────────────

/** Maximum number of history entries kept in state and IDB. */
export const MAX_HISTORY = 50;

// ── Editor ────────────────────────────────────────────────────────────────────

/** Estimated row height (px) used by the virtual table. */
export const ESTIMATED_ROW_HEIGHT = 36;

/** Debounce delay (ms) before persisting editor text to IDB. */
export const DEBOUNCE_MS = 500;

// ── Utilities ─────────────────────────────────────────────────────────────────

export function uid(): string {
  return crypto.randomUUID();
}
