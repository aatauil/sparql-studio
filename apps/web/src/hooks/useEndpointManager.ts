import { useEffect, useState } from "react";
import { endpointStore, settingsStore, type AppSettings, type EndpointEntry } from "../storage";
import { uid } from "../config";

export interface EndpointManager {
  endpoints: EndpointEntry[];
  activeEndpointId: string;
  activeEndpoint: EndpointEntry | undefined;
  error: string | null;
  selectEndpoint: (id: string) => Promise<void>;
  addEndpoint: (label: string, url: string) => Promise<void>;
  removeEndpoint: (id: string) => Promise<void>;
}

export function useEndpointManager(
  settingsLoaded: boolean,
  initialActiveEndpointId: string,
  settings: AppSettings,
  setSettings: (s: AppSettings) => void
): EndpointManager {
  const [endpoints, setEndpoints] = useState<EndpointEntry[]>([]);
  const [activeEndpointId, setActiveEndpointId] = useState<string>(initialActiveEndpointId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsLoaded) return;
    setActiveEndpointId(initialActiveEndpointId);
    endpointStore.list().then((list) =>
      setEndpoints(list.sort((a, b) => a.createdAt - b.createdAt))
    ).catch(() => {
      setError("Could not load saved endpoints.");
    });
  }, [settingsLoaded, initialActiveEndpointId]);

  async function selectEndpoint(id: string) {
    setActiveEndpointId(id);
    const next = { ...settings, activeEndpointId: id };
    setSettings(next);
    await settingsStore.set(next);
  }

  async function addEndpoint(label: string, url: string) {
    const entry: EndpointEntry = { id: uid(), label, url, createdAt: Date.now() };
    await endpointStore.upsert(entry);
    setEndpoints((prev) => [...prev, entry]);
    await selectEndpoint(entry.id);
  }

  async function removeEndpoint(id: string) {
    await endpointStore.remove(id);
    setEndpoints((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (id === activeEndpointId && next.length > 0) {
        void selectEndpoint(next[0].id);
      }
      return next;
    });
  }

  const activeEndpoint = endpoints.find((e) => e.id === activeEndpointId);

  return {
    endpoints,
    activeEndpointId,
    activeEndpoint,
    error,
    selectEndpoint,
    addEndpoint,
    removeEndpoint
  };
}
