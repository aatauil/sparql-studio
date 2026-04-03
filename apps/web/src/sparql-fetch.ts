import type { BridgeResponse, SparqlJsonResult } from "@sparql-studio/contracts";

export function normalizeEndpointUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(normalizeEndpointUrl(url));
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export async function directFetch(
  endpointUrl: string,
  query: string,
  timeoutMs: number
): Promise<BridgeResponse<SparqlJsonResult>> {
  const requestId = crypto.randomUUID();
  const normalizedUrl = normalizeEndpointUrl(endpointUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(normalizedUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        accept: "application/sparql-results+json"
      },
      body: new URLSearchParams({ query }).toString(),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.text();
        // Virtuoso and many SPARQL endpoints return HTML error pages — extract just the text
        const stripped = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        detail = stripped.length > 300 ? stripped.slice(0, 300) + "…" : stripped;
      } catch {
        // ignore body read failures
      }
      const message = detail
        ? `HTTP ${res.status}: ${detail}`
        : `Endpoint responded with HTTP ${res.status}.`;
      return {
        ok: false,
        requestId,
        error: { code: "INVALID_RESPONSE", message }
      };
    }
    const data: SparqlJsonResult = await res.json();
    return { ok: true, requestId, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      requestId,
      error: {
        code: isAbort ? "TIMEOUT" : "ENDPOINT_UNREACHABLE",
        message: isAbort ? "Query timed out." : "Could not reach endpoint."
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
