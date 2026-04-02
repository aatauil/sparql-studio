import { useMemo, useState } from "react";
import { BridgeClient } from "../bridge";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "../sparql-fetch";
import type { SparqlJsonResult } from "@sparql-studio/contracts";

export interface ExecuteQueryState {
  result: SparqlJsonResult | null;
  isRunning: boolean;
  error: string | null;
  run: (query: string) => Promise<void>;
}

export function useExecuteQuery(endpointUrl: string, timeoutMs: number, extensionId: string): ExecuteQueryState {
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridge = useMemo(() => new BridgeClient(extensionId), [extensionId]);

  async function run(query: string): Promise<void> {
    setIsRunning(true);
    setError(null);

    const url = normalizeEndpointUrl(endpointUrl);
    const response = isLocalhostUrl(url)
      ? await bridge.executeQuery({ endpointUrl: url, timeoutMs, query })
      : await directFetch(url, query, timeoutMs);

    if (response.ok) {
      setResult(response.data);
    } else {
      setError(response.error.message);
    }
    setIsRunning(false);
  }

  return { result, isRunning, error, run };
}
