import { useEffect, useState } from "react";
import { endpointStore, settingsStore, type AppSettings, type EndpointEntry } from "../storage";

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

export function useSettings(): { settings: AppSettings; isLoaded: boolean } {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const existing = await settingsStore.get();
      if (existing) {
        setSettings(existing);
      } else {
        await endpointStore.upsert(DEFAULT_ENDPOINT);
        await settingsStore.set(defaultSettings);
      }
      setIsLoaded(true);
    })();
  }, []);

  return { settings, isLoaded };
}
