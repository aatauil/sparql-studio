import type { BridgeResponse, HttpResponseInfo, SparqlJsonResult } from "@sparql-studio/contracts";

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
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<BridgeResponse<SparqlJsonResult>> {
  const requestId = crypto.randomUUID();
  const normalizedUrl = normalizeEndpointUrl(endpointUrl);
  const controller = new AbortController();
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
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
    const rawBody = await res.text().catch(() => "");
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => { headers[key] = value; });
    const httpResponse: HttpResponseInfo = {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: rawBody.length > 51200 ? rawBody.slice(0, 51200) + "\n…[truncated]" : rawBody
    };

    if (!res.ok) {
      const contentType = headers["content-type"] ?? "";
      let detail = "";
      if (contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(rawBody);
          detail = parsed?.message ?? parsed?.error?.message ?? parsed?.error ?? "";
          if (typeof detail !== "string") detail = JSON.stringify(detail);
        } catch {
          // fall through to text stripping
        }
      }
      const message = detail || `HTTP ${res.status} ${res.statusText}`;
      return {
        ok: false,
        requestId,
        error: { code: "INVALID_RESPONSE", message },
        httpResponse
      };
    }

    let data: SparqlJsonResult;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return {
        ok: false,
        requestId,
        error: { code: "INVALID_RESPONSE", message: "Endpoint returned non-JSON response." },
        httpResponse
      };
    }
    return { ok: true, requestId, data, httpResponse };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      requestId,
      error: {
        code: isAbort ? "TIMEOUT" : "ENDPOINT_UNREACHABLE",
        message: isAbort ? "Query timed out." : `Could not reach endpoint: ${detail}`
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
