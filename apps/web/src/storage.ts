import { openDB, deleteDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { SparqlJsonResult } from "@sparql-studio/contracts";

export interface ResultMeta {
  durationMs: number;
  rowCount: number;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface SavedQuery {
  id: string;
  title: string;
  queryText: string;
  color?: string;
  lastResult?: SparqlJsonResult;
  lastResultMeta?: ResultMeta;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface QueryHistoryEntry {
  id: string;
  queryText: string;
  endpoint: string;
  startedAt: number;
  durationMs: number;
  status: "success" | "error";
  rowCount: number;
  preview?: string;
  error?: string;
}

export interface PrefixEntry {
  prefix: string;
  iri: string;
  source: "local" | "imported";
  updatedAt: number;
  enabled?: boolean; // undefined treated as true (backward compatible)
}

export interface EndpointEntry {
  id: string;
  label: string;
  url: string;
  createdAt: number;
}

export interface AppSettings {
  key: "settings";
  activeEndpointId: string;
  extensionId: string;
  timeoutMs: number;
}

// One entry per DB version. Each function only creates/modifies what's new for that version.
// To add v3: append a new function. DB version is derived from array length automatically.
const MIGRATIONS: Array<(db: IDBPDatabase) => void> = [
  // v1 — initial schema
  (db) => {
    db.createObjectStore("savedQueries", { keyPath: "id" });
    db.createObjectStore("queryHistory", { keyPath: "id" });
    db.createObjectStore("prefixLibrary", { keyPath: "prefix" });
    db.createObjectStore("appSettings", { keyPath: "key" });
  },
  // v2 — endpoints store
  (db) => {
    db.createObjectStore("endpoints", { keyPath: "id" });
  },
];

// Set to true after a corrupt-DB recovery so hooks can surface a warning to the user.
export let storageWasReset = false;

function buildDB() {
  return openDB("sparql-studio", MIGRATIONS.length, {
    upgrade(db, oldVersion, newVersion) {
      for (let v = oldVersion; v < (newVersion ?? MIGRATIONS.length); v++) {
        MIGRATIONS[v](db);
      }
    },
    blocked() {
      console.warn("[sparql-studio] DB upgrade blocked — close other tabs and reload.");
    },
    blocking() {
      // This tab is holding back a newer version in another tab; reload to yield.
      window.location.reload();
    },
  });
}

async function openWithRecovery() {
  try {
    return await buildDB();
  } catch (err) {
    console.error("[sparql-studio] Failed to open IndexedDB, resetting storage:", err);
    await deleteDB("sparql-studio");
    storageWasReset = true;
    return buildDB();
  }
}

const dbPromise = openWithRecovery();

export const queryStore = {
  async list(): Promise<SavedQuery[]> {
    return (await dbPromise).getAll("savedQueries");
  },
  async upsert(item: SavedQuery): Promise<void> {
    await (await dbPromise).put("savedQueries", item);
  },
  async remove(id: string): Promise<void> {
    await (await dbPromise).delete("savedQueries", id);
  }
};

export const historyStore = {
  async list(): Promise<QueryHistoryEntry[]> {
    return (await dbPromise).getAll("queryHistory");
  },
  async add(item: QueryHistoryEntry): Promise<void> {
    await (await dbPromise).put("queryHistory", item);
  },
  async remove(id: string): Promise<void> {
    await (await dbPromise).delete("queryHistory", id);
  },
  async clear(): Promise<void> {
    await (await dbPromise).clear("queryHistory");
  }
};

export const prefixStore = {
  async list(): Promise<PrefixEntry[]> {
    return (await dbPromise).getAll("prefixLibrary");
  },
  async upsert(item: PrefixEntry): Promise<void> {
    await (await dbPromise).put("prefixLibrary", item);
  },
  async remove(prefix: string): Promise<void> {
    await (await dbPromise).delete("prefixLibrary", prefix);
  }
};

export const endpointStore = {
  async list(): Promise<EndpointEntry[]> {
    return (await dbPromise).getAll("endpoints");
  },
  async get(id: string): Promise<EndpointEntry | undefined> {
    return (await dbPromise).get("endpoints", id);
  },
  async upsert(item: EndpointEntry): Promise<void> {
    await (await dbPromise).put("endpoints", item);
  },
  async remove(id: string): Promise<void> {
    await (await dbPromise).delete("endpoints", id);
  }
};

export const settingsStore = {
  async get(): Promise<AppSettings | undefined> {
    return (await dbPromise).get("appSettings", "settings");
  },
  async set(settings: AppSettings): Promise<void> {
    await (await dbPromise).put("appSettings", settings);
  }
};
