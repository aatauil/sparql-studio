export const BRIDGE_SOURCE = "sparql-studio-web";
export const BRIDGE_TARGET = "sparql-studio-extension";

export type BridgeMessageType = "healthCheck" | "executeQuery";

export interface ExecuteQueryPayload {
  endpointUrl: string;
  query: string;
  timeoutMs: number;
}

export interface HealthCheckPayload {
  endpointUrl: string;
  timeoutMs: number;
}

export interface BridgeRequest<T = unknown> {
  source: typeof BRIDGE_SOURCE;
  target: typeof BRIDGE_TARGET;
  type: BridgeMessageType;
  requestId: string;
  payload: T;
}

export interface BridgeSuccess<T = unknown> {
  ok: true;
  requestId: string;
  data: T;
}

export interface BridgeFailure {
  ok: false;
  requestId: string;
  error: {
    code:
      | "EXTENSION_UNAVAILABLE"
      | "ENDPOINT_UNREACHABLE"
      | "TIMEOUT"
      | "INVALID_RESPONSE"
      | "UNKNOWN";
    message: string;
  };
}

export type BridgeResponse<T = unknown> = BridgeSuccess<T> | BridgeFailure;

export interface SparqlBinding {
  type: "uri" | "literal" | "bnode";
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

export interface SparqlJsonResult {
  head: { vars: string[] };
  results: { bindings: Record<string, SparqlBinding>[] };
}
