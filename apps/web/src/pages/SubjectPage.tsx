import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useSettings } from "../hooks/useSettings";
import { useExecuteQuery } from "../hooks/useBridgeQuery";
import { endpointStore } from "../storage";
import { ResultsTable } from "../components/ResultsTable";

export function SubjectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const uri = searchParams.get("uri") ?? "";

  const { settings, isLoaded } = useSettings();
  const [endpointUrl, setEndpointUrl] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    endpointStore.get(settings.activeEndpointId).then((ep) => setEndpointUrl(ep?.url ?? ""));
  }, [isLoaded, settings.activeEndpointId]);

  const outgoing = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const incoming = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);

  useEffect(() => {
    if (!isLoaded || !uri || !endpointUrl) return;
    void Promise.all([
      outgoing.run(`SELECT ?p ?o WHERE { <${uri}> ?p ?o }`),
      incoming.run(`SELECT ?s ?p WHERE { ?s ?p <${uri}> }`)
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, uri, endpointUrl]);

  function handleNavigateToSubject(targetUri: string) {
    navigate("/subject?uri=" + encodeURIComponent(targetUri));
  }

  function renderSection(
    label: string,
    { result, isRunning, error }: ReturnType<typeof useExecuteQuery>
  ) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col min-h-0">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg m-0">
          {label}
        </h2>
        <div className="flex-1 min-h-0 overflow-auto">
          {isRunning && <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>}
          {!isRunning && error && (
            <p className="px-4 py-3 text-red-600 text-sm">{error}</p>
          )}
          {!isRunning && !error && result && result.results.bindings.length === 0 && (
            <p className="px-4 py-3 text-gray-500 text-sm">No results.</p>
          )}
          {!isRunning && !error && result && result.results.bindings.length > 0 && (
            <ResultsTable result={result} onNavigateToSubject={handleNavigateToSubject} />
          )}
          {!isRunning && !error && !result && !uri && (
            <p className="px-4 py-3 text-gray-500 text-sm">No subject URI provided.</p>
          )}
        </div>
      </section>
    );
  }

  const outgoingCount = outgoing.result?.results.bindings.length ?? null;
  const incomingCount = incoming.result?.results.bindings.length ?? null;
  const statusParts: string[] = [];
  if (outgoingCount !== null) statusParts.push(`Outgoing: ${outgoingCount} triple${outgoingCount !== 1 ? "s" : ""}`);
  if (incomingCount !== null) statusParts.push(`Incoming: ${incomingCount} triple${incomingCount !== 1 ? "s" : ""}`);
  const statusMessage = statusParts.length > 0 ? statusParts.join(" | ") : (outgoing.isRunning || incoming.isRunning ? "Loading…" : "Ready.");

  return (
    <main className="h-screen overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
        <button
          className="btn-dark"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <i className="ri-arrow-left-line" /> Back
        </button>
        <span className="font-semibold text-white">Subject</span>
        <span className="text-[#9ca3af] text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
          {uri || "—"}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden bg-gray-100">
        {renderSection(`Outgoing triples  ·  <${uri}> ?p ?o`, outgoing)}
        {renderSection(`Incoming triples  ·  ?s ?p <${uri}>`, incoming)}
      </div>

      {/* Status bar */}
      <div
        className="shrink-0 bg-[#007acc] text-white text-[0.72rem] px-3 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
        role="status"
      >
        {statusMessage}
      </div>
    </main>
  );
}
