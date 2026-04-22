const BRIDGE_SOURCE = "sparql-studio-web";
const BRIDGE_TARGET = "sparql-studio-extension";

function createError(requestId, code, message) {
  return { ok: false, requestId, error: { code, message } };
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

async function testEndpoint(endpointUrl, timeoutMs) {
  const { signal, cleanup } = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(endpointUrl, { method: "OPTIONS", signal });
    return { ok: response.ok || response.status < 500 };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail };
  } finally {
    cleanup();
  }
}

async function executeQuery(endpointUrl, query, timeoutMs) {
  const { signal, cleanup } = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        accept: "application/sparql-results+json"
      },
      body: new URLSearchParams({ query }).toString(),
      signal
    });

    const rawBody = await response.text().catch(() => "");
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    const httpResponse = {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: rawBody.length > 51200 ? rawBody.slice(0, 51200) + "\n…[truncated]" : rawBody
    };

    if (!response.ok) {
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
      const message = detail || `HTTP ${response.status} ${response.statusText}`;
      return { error: { code: "INVALID_RESPONSE", message }, httpResponse };
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return { error: { code: "INVALID_RESPONSE", message: "Endpoint returned non-JSON response." }, httpResponse };
    }
    if (!data?.head?.vars || !data?.results?.bindings) {
      return { error: { code: "INVALID_RESPONSE", message: "Endpoint returned non SPARQL JSON format." }, httpResponse };
    }

    return { data, httpResponse };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: { code: "TIMEOUT", message: "Query request timed out." } };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { error: { code: "ENDPOINT_UNREACHABLE", message: `Could not reach endpoint: ${detail}` } };
  } finally {
    cleanup();
  }
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  const requestId = message?.requestId ?? crypto.randomUUID();
  if (message?.source !== BRIDGE_SOURCE || message?.target !== BRIDGE_TARGET) {
    sendResponse(createError(requestId, "UNKNOWN", "Unsupported message envelope."));
    return false;
  }

  if (message.type === "healthCheck") {
    const endpointUrl = message?.payload?.endpointUrl;
    const timeoutMs = Number(message?.payload?.timeoutMs ?? 4000);
    testEndpoint(endpointUrl, timeoutMs).then((result) => {
      if (result.ok) {
        sendResponse({ ok: true, requestId, data: { reachable: true } });
      } else {
        const message = result.detail
          ? `Could not reach endpoint: ${result.detail}`
          : "Could not reach endpoint.";
        sendResponse(createError(requestId, "ENDPOINT_UNREACHABLE", message));
      }
    });
    return true;
  }

  if (message.type === "executeQuery") {
    const endpointUrl = message?.payload?.endpointUrl;
    const query = message?.payload?.query;
    const timeoutMs = Number(message?.payload?.timeoutMs ?? 15000);
    executeQuery(endpointUrl, query, timeoutMs).then((result) => {
      if (result.error) {
        sendResponse({ ok: false, requestId, error: result.error, httpResponse: result.httpResponse });
      } else {
        sendResponse({ ok: true, requestId, data: result.data, httpResponse: result.httpResponse });
      }
    });
    return true;
  }

  sendResponse(createError(requestId, "UNKNOWN", "Unsupported message type."));
  return false;
});
