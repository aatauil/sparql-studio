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
  } catch (_error) {
    return { ok: false };
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

    if (!response.ok) {
      return { error: { code: "ENDPOINT_UNREACHABLE", message: `Virtuoso responded with ${response.status}.` } };
    }

    const data = await response.json();
    if (!data?.head?.vars || !data?.results?.bindings) {
      return { error: { code: "INVALID_RESPONSE", message: "Endpoint returned non SPARQL JSON format." } };
    }

    return { data };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: { code: "TIMEOUT", message: "Query request timed out." } };
    }
    return { error: { code: "ENDPOINT_UNREACHABLE", message: "Could not reach the local endpoint." } };
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
        sendResponse(createError(requestId, "ENDPOINT_UNREACHABLE", "Could not reach endpoint."));
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
        sendResponse(createError(requestId, result.error.code, result.error.message));
      } else {
        sendResponse({ ok: true, requestId, data: result.data });
      }
    });
    return true;
  }

  sendResponse(createError(requestId, "UNKNOWN", "Unsupported message type."));
  return false;
});
