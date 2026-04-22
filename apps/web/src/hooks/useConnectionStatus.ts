import { useEffect, useRef, useState } from "react";
import { BridgeClient } from "../bridge";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "../sparql-fetch";

export type ConnectionStatus = "checking" | "connected" | "disconnected";

const PROBE_QUERY = "SELECT (1 AS ?x) WHERE {}";
const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

export function useConnectionStatus(
  endpointUrl: string,
  timeoutMs: number,
  extensionId: string
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!endpointUrl) {
      setStatus("disconnected");
      return;
    }

    let cancelled = false;

    async function probe() {
      if (cancelled) return;
      setStatus("checking");

      const url = normalizeEndpointUrl(endpointUrl);
      let ok: boolean;

      if (isLocalhostUrl(url)) {
        const bridge = new BridgeClient(extensionId);
        if (!bridge.isAvailable()) {
          ok = false;
        } else {
          const res = await bridge.executeQuery({
            endpointUrl: url,
            timeoutMs: Math.min(timeoutMs, PROBE_TIMEOUT_MS),
            query: PROBE_QUERY
          });
          ok = res.ok;
        }
      } else {
        const res = await directFetch(url, PROBE_QUERY, Math.min(timeoutMs, PROBE_TIMEOUT_MS));
        ok = res.ok;
      }

      if (!cancelled) {
        setStatus(ok ? "connected" : "disconnected");
        timerRef.current = setTimeout(() => void probe(), POLL_INTERVAL_MS);
      }
    }

    void probe();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [endpointUrl, timeoutMs, extensionId]);

  return status;
}
