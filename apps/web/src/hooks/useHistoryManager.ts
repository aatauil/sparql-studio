import { useCallback, useEffect, useState } from "react";
import { historyStore, type QueryHistoryEntry } from "../storage";

const MAX_HISTORY = 50;

export function useHistoryManager() {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);

  useEffect(() => {
    historyStore.list().then((entries) => {
      setHistory(entries.sort((a, b) => b.startedAt - a.startedAt));
    });
  }, []);

  const addEntry = useCallback(async (entry: QueryHistoryEntry) => {
    await historyStore.add(entry);
    setHistory((prev) => {
      const next = [entry, ...prev];
      if (next.length > MAX_HISTORY) {
        const evicted = next[MAX_HISTORY];
        historyStore.remove(evicted.id);
        return next.slice(0, MAX_HISTORY);
      }
      return next;
    });
  }, []);

  return { history, addEntry };
}
