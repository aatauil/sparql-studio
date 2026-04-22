import { useEffect, useRef, useState } from "react";
import { BridgeClient } from "../bridge";
import { normalizeEndpointUrl } from "../sparql-fetch";

export type BridgeStatus = "unconfigured" | "checking" | "active" | "error";

const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

export function useBridgeStatus(
  endpointUrl: string,
  timeoutMs: number,
  extensionId: string
): BridgeStatus {
  const [status, setStatus] = useState<BridgeStatus>("unconfigured");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!endpointUrl || !extensionId) {
      setStatus("unconfigured");
      return;
    }

    let cancelled = false;

    async function probe() {
      if (cancelled) return;
      setStatus("checking");

      const bridge = new BridgeClient(extensionId);
      const res = await bridge.healthCheck({
        endpointUrl: normalizeEndpointUrl(endpointUrl),
        timeoutMs: Math.min(timeoutMs, PROBE_TIMEOUT_MS)
      });

      if (!cancelled) {
        setStatus(res.ok ? "active" : "error");
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
