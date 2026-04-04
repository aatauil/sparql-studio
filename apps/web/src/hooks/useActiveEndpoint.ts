import { useEffect, useState } from "react";
import { endpointStore, type AppSettings } from "../storage";
import { useSettings } from "./useSettings";

/**
 * Composes `useSettings` with an endpoint lookup so pages don't duplicate
 * the "load settings → get endpoint URL" pattern.
 */
export function useActiveEndpoint(): {
  endpointUrl: string;
  isLoaded: boolean;
  settings: AppSettings;
} {
  const { settings, isLoaded } = useSettings();
  const [endpointUrl, setEndpointUrl] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    endpointStore.get(settings.activeEndpointId).then((ep) => setEndpointUrl(ep?.url ?? ""));
  }, [isLoaded, settings.activeEndpointId]);

  return { endpointUrl, isLoaded, settings };
}
