import { useEffect, useState } from "react";
import { settingsStore, type AppSettings } from "../storage";

export const defaultSettings: AppSettings = {
  key: "settings",
  endpointUrl: "http://localhost:8890/sparql",
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
        await settingsStore.set(defaultSettings);
      }
      setIsLoaded(true);
    })();
  }, []);

  return { settings, isLoaded };
}
