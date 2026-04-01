import { useMemo, useState } from "react";
import { BridgeClient } from "../bridge";
import type { AppSettings } from "../storage";
import type { SparqlJsonResult } from "@sparql-studio/contracts";

export interface BridgeQueryState {
  result: SparqlJsonResult | null;
  isRunning: boolean;
  error: string | null;
  run: (query: string) => Promise<void>;
}

export function useBridgeQuery(settings: AppSettings): BridgeQueryState {
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridge = useMemo(
    () => new BridgeClient({ extensionId: settings.extensionId }),
    [settings.extensionId]
  );

  async function run(query: string): Promise<void> {
    setIsRunning(true);
    setError(null);
    bridge.setExtensionId(settings.extensionId);
    const response = await bridge.executeQuery({
      endpointUrl: settings.endpointUrl,
      timeoutMs: settings.timeoutMs,
      query
    });
    if (response.ok) {
      setResult(response.data);
    } else {
      setError(response.error.message);
    }
    setIsRunning(false);
  }

  return { result, isRunning, error, run };
}
