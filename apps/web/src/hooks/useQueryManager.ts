import { useCallback, useEffect, useRef, useState } from "react";
import { queryStore, type ResultMeta, type SavedQuery } from "../storage";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import {
  CURRENT_QUERY_KEY,
  ACTIVE_QUERY_KEY,
  DEFAULT_QUERY,
  IDB_RESULT_ROW_CAP,
  DEBOUNCE_MS,
  uid
} from "../config";

export interface QueryManager {
  savedQueries: SavedQuery[];
  activeQueryId: string;
  queryText: string;
  activeQuery: SavedQuery | undefined;
  setQueryText: (text: string) => void;
  switchQuery: (id: string) => Promise<void>;
  newQuery: () => Promise<void>;
  renameQuery: (id: string, title: string) => Promise<void>;
  colorQuery: (id: string, color: string) => Promise<void>;
  deleteQuery: (id: string) => Promise<void>;
  persistResult: (meta: ResultMeta, result?: SparqlJsonResult) => void;
}

export function useQueryManager(settingsLoaded: boolean): QueryManager {
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [activeQueryId, setActiveQueryId] = useState<string>(
    () => localStorage.getItem(ACTIVE_QUERY_KEY) ?? ""
  );
  const [queryText, _setQueryText] = useState(
    () => localStorage.getItem(CURRENT_QUERY_KEY) ?? DEFAULT_QUERY
  );

  // Refs to avoid stale closures in debounced callbacks — contained here
  const activeQueryIdRef = useRef(activeQueryId);
  useEffect(() => { activeQueryIdRef.current = activeQueryId; }, [activeQueryId]);
  const savedQueriesRef = useRef<SavedQuery[]>([]);
  useEffect(() => { savedQueriesRef.current = savedQueries; }, [savedQueries]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist query text to localStorage immediately; debounce IDB save
  const setQueryText = useCallback((text: string) => {
    _setQueryText(text);
    localStorage.setItem(CURRENT_QUERY_KEY, text);
    const id = activeQueryIdRef.current;
    if (!id) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const now = Date.now();
      setSavedQueries((prev) =>
        prev.map((q) => (q.id === id ? { ...q, queryText: text, updatedAt: now } : q))
      );
      const q = savedQueriesRef.current.find((x) => x.id === id);
      if (q) void queryStore.upsert({ ...q, queryText: text, updatedAt: now });
    }, DEBOUNCE_MS);
  }, []);

  // Load queries from IDB once settings are ready
  useEffect(() => {
    if (!settingsLoaded) return;
    (async () => {
      let queries = (await queryStore.list()).sort((a, b) => b.updatedAt - a.updatedAt);

      if (queries.length === 0) {
        const now = Date.now();
        const defaultQuery: SavedQuery = {
          id: uid(),
          title: "Untitled",
          queryText: localStorage.getItem(CURRENT_QUERY_KEY) ?? DEFAULT_QUERY,
          tags: [],
          createdAt: now,
          updatedAt: now
        };
        await queryStore.upsert(defaultQuery);
        queries = [defaultQuery];
      }

      setSavedQueries(queries);

      const storedId = localStorage.getItem(ACTIVE_QUERY_KEY) ?? "";
      const active = queries.find((q) => q.id === storedId) ?? queries[0];
      setActiveQueryId(active.id);
      localStorage.setItem(ACTIVE_QUERY_KEY, active.id);
      _setQueryText(active.queryText);
      localStorage.setItem(CURRENT_QUERY_KEY, active.queryText);
    })();
  }, [settingsLoaded]);

  // ── Flush helper (flush debounced text to IDB immediately) ──────────────────

  async function flushCurrentQuery() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const id = activeQueryIdRef.current;
    if (!id) return;
    const q = savedQueriesRef.current.find((x) => x.id === id);
    if (!q) return;
    const now = Date.now();
    const text = localStorage.getItem(CURRENT_QUERY_KEY) ?? q.queryText;
    const updated = { ...q, queryText: text, updatedAt: now };
    setSavedQueries((prev) => prev.map((x) => (x.id === id ? updated : x)));
    await queryStore.upsert(updated);
  }

  // ── Query CRUD ───────────────────────────────────────────────────────────────

  async function switchQuery(id: string) {
    await flushCurrentQuery();
    const target = savedQueriesRef.current.find((q) => q.id === id);
    if (!target) return;
    setActiveQueryId(id);
    localStorage.setItem(ACTIVE_QUERY_KEY, id);
    _setQueryText(target.queryText);
    localStorage.setItem(CURRENT_QUERY_KEY, target.queryText);
  }

  async function newQuery() {
    await flushCurrentQuery();
    const id = uid();
    const now = Date.now();
    const query: SavedQuery = {
      id,
      title: "Untitled",
      queryText: DEFAULT_QUERY,
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    await queryStore.upsert(query);
    setSavedQueries((prev) => [query, ...prev]);
    setActiveQueryId(id);
    localStorage.setItem(ACTIVE_QUERY_KEY, id);
    _setQueryText(DEFAULT_QUERY);
    localStorage.setItem(CURRENT_QUERY_KEY, DEFAULT_QUERY);
  }

  async function renameQuery(id: string, title: string) {
    setSavedQueries((prev) => {
      const updated = prev.map((q) => (q.id === id ? { ...q, title } : q));
      const q = updated.find((x) => x.id === id);
      if (q) void queryStore.upsert(q);
      return updated;
    });
  }

  async function colorQuery(id: string, color: string) {
    setSavedQueries((prev) => {
      const updated = prev.map((q) => (q.id === id ? { ...q, color } : q));
      const q = updated.find((x) => x.id === id);
      if (q) void queryStore.upsert(q);
      return updated;
    });
  }

  async function deleteQuery(id: string) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    await queryStore.remove(id);
    const isActive = id === activeQueryIdRef.current;
    const remaining = savedQueriesRef.current.filter((q) => q.id !== id);
    setSavedQueries(remaining);

    if (isActive) {
      if (remaining.length > 0) {
        const next = remaining[0];
        setActiveQueryId(next.id);
        localStorage.setItem(ACTIVE_QUERY_KEY, next.id);
        _setQueryText(next.queryText);
        localStorage.setItem(CURRENT_QUERY_KEY, next.queryText);
      } else {
        const now = Date.now();
        const fresh: SavedQuery = { id: uid(), title: "Untitled", queryText: DEFAULT_QUERY, tags: [], createdAt: now, updatedAt: now };
        await queryStore.upsert(fresh);
        setSavedQueries([fresh]);
        setActiveQueryId(fresh.id);
        localStorage.setItem(ACTIVE_QUERY_KEY, fresh.id);
        _setQueryText(DEFAULT_QUERY);
        localStorage.setItem(CURRENT_QUERY_KEY, DEFAULT_QUERY);
      }
    }
  }

  // ── Result persistence ───────────────────────────────────────────────────────

  const persistResult = useCallback((meta: ResultMeta, result?: SparqlJsonResult) => {
    const id = activeQueryIdRef.current;
    if (!id) return;
    const resultToStore = result && result.results.bindings.length <= IDB_RESULT_ROW_CAP ? result : undefined;
    setSavedQueries((prev) => {
      const updated = prev.map((q) =>
        q.id === id
          ? { ...q, lastResult: resultToStore, lastResultMeta: meta, updatedAt: Date.now() }
          : q
      );
      const q = updated.find((x) => x.id === id);
      if (q) void queryStore.upsert(q);
      return updated;
    });
  }, []);

  const activeQuery = savedQueries.find((q) => q.id === activeQueryId);

  return {
    savedQueries,
    activeQueryId,
    queryText,
    activeQuery,
    setQueryText,
    switchQuery,
    newQuery,
    renameQuery,
    colorQuery,
    deleteQuery,
    persistResult
  };
}
