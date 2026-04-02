import { openDB } from "idb";

export interface SavedQuery {
  id: string;
  title: string;
  queryText: string;
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
}

export interface AppSettings {
  key: "settings";
  endpointUrl: string;
  extensionId: string;
  timeoutMs: number;
}

const dbPromise = openDB("sparql-studio", 1, {
  upgrade(db) {
    db.createObjectStore("savedQueries", { keyPath: "id" });
    db.createObjectStore("queryHistory", { keyPath: "id" });
    db.createObjectStore("prefixLibrary", { keyPath: "prefix" });
    db.createObjectStore("appSettings", { keyPath: "key" });
  }
});

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

export const settingsStore = {
  async get(): Promise<AppSettings | undefined> {
    return (await dbPromise).get("appSettings", "settings");
  },
  async set(settings: AppSettings): Promise<void> {
    await (await dbPromise).put("appSettings", settings);
  }
};
