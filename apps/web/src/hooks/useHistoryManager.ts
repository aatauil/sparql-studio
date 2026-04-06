import { useCallback, useEffect, useState } from "react";
import { historyStore, type QueryHistoryEntry } from "../storage";
import { MAX_HISTORY } from "../config";

export function useHistoryManager() {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyStore.list().then((entries) => {
      setHistory(entries.sort((a, b) => b.startedAt - a.startedAt));
    }).catch(() => {
      setError("Could not load query history.");
    });
  }, []);

  const addEntry = useCallback(async (entry: QueryHistoryEntry) => {
    await historyStore.add(entry);
    let evictedId: string | null = null;
    setHistory((prev) => {
      const next = [entry, ...prev];
      if (next.length > MAX_HISTORY) {
        evictedId = next[MAX_HISTORY].id;
        return next.slice(0, MAX_HISTORY);
      }
      return next;
    });
    if (evictedId) await historyStore.remove(evictedId);
  }, []);

  return { history, error, addEntry };
}
