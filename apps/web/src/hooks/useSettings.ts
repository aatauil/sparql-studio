import { useEffect, useState } from "react";
import { endpointStore, settingsStore, storageWasReset, type AppSettings, type EndpointEntry } from "../storage";

const DEFAULT_ENDPOINT: EndpointEntry = {
  id: "default-dbpedia",
  label: "DBpedia",
  url: "https://dbpedia.org/sparql",
  createdAt: 0
};

export const defaultSettings: AppSettings = {
  key: "settings",
  activeEndpointId: DEFAULT_ENDPOINT.id,
  extensionId: "",
  timeoutMs: 15000
};

export function useSettings(): { settings: AppSettings; isLoaded: boolean; error: string | null; storageReset: boolean } {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const existing = await settingsStore.get();
        if (existing) {
          setSettings(existing);
        } else {
          await endpointStore.upsert(DEFAULT_ENDPOINT);
          await settingsStore.set(defaultSettings);
        }
        setIsLoaded(true);
      } catch {
        /* settingsStore/endpointStore use IndexedDB — may be unavailable in
           private browsing or when storage quota is exceeded */
        setError("Browser storage is unavailable. Try disabling private browsing or clearing site data.");
      }
    })();
  }, []);

  return { settings, isLoaded, error, storageReset: storageWasReset };
}
