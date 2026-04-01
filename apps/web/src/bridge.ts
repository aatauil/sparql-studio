import {
  BRIDGE_SOURCE,
  BRIDGE_TARGET,
  type BridgeResponse,
  type ExecuteQueryPayload,
  type HealthCheckPayload,
  type SparqlJsonResult
} from "@sparql-studio/contracts";

interface BridgeClientOptions {
  extensionId: string;
}

export class BridgeClient {
  private extensionId: string;

  constructor(options: BridgeClientOptions) {
    this.extensionId = options.extensionId;
  }

  setExtensionId(extensionId: string) {
    this.extensionId = extensionId;
  }

  private sendMessage<TPayload, TData>(type: "healthCheck" | "executeQuery", payload: TPayload): Promise<BridgeResponse<TData>> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      type RuntimeLike = {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback: (response: BridgeResponse<TData>) => void
        ) => void;
        lastError?: { message?: string };
      };
      const runtime = (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime;
      if (!this.extensionId || !runtime?.sendMessage) {
        resolve({
          ok: false,
          requestId,
          error: { code: "EXTENSION_UNAVAILABLE", message: "Browser extension API is unavailable." }
        });
        return;
      }

      runtime.sendMessage(
        this.extensionId,
        { source: BRIDGE_SOURCE, target: BRIDGE_TARGET, type, requestId, payload },
        (response: BridgeResponse<TData>) => {
          if (runtime.lastError) {
            resolve({
              ok: false,
              requestId,
              error: { code: "EXTENSION_UNAVAILABLE", message: runtime.lastError.message ?? "Unknown extension error." }
            });
            return;
          }
          resolve(response);
        }
      );
    });
  }

  healthCheck(payload: HealthCheckPayload) {
    return this.sendMessage<HealthCheckPayload, { reachable: boolean }>("healthCheck", payload);
  }

  executeQuery(payload: ExecuteQueryPayload) {
    return this.sendMessage<ExecuteQueryPayload, SparqlJsonResult>("executeQuery", payload);
  }
}
