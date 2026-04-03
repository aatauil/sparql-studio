import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useSettings } from "../hooks/useSettings";
import { useExecuteQuery } from "../hooks/useBridgeQuery";
import { endpointStore } from "../storage";
import { ResultsTable } from "../components/ResultsTable";
import type { SparqlJsonResult } from "@sparql-studio/contracts";

const EXCLUDED_GRAPHS_KEY = "sparql-studio:excludedGraphs";

function loadExcludedGraphs(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_GRAPHS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveExcludedGraphs(set: Set<string>) {
  localStorage.setItem(EXCLUDED_GRAPHS_KEY, JSON.stringify([...set]));
}

function filterByGraph(result: SparqlJsonResult, excluded: Set<string>): SparqlJsonResult {
  if (excluded.size === 0) return result;
  return {
    ...result,
    results: {
      bindings: result.results.bindings.filter(
        (b) => !b.g || !excluded.has((b.g as { value: string }).value)
      )
    }
  };
}

function uniqueGraphs(result: SparqlJsonResult | null): string[] {
  if (!result) return [];
  const seen = new Set<string>();
  for (const b of result.results.bindings) {
    if (b.g) seen.add((b.g as { value: string }).value);
  }
  return [...seen].sort();
}

function graphLabel(uri: string): string {
  return uri.length > 60 ? uri.slice(0, 58) + "…" : uri;
}

function shortLabel(uri: string): string {
  const afterHash = uri.split("#").pop() ?? "";
  const afterSlash = uri.split("/").pop() ?? "";
  const local = afterHash.length > 1 ? afterHash : afterSlash;
  return local.length > 0 && local.length < 50 ? local : uri.slice(0, 40) + "…";
}

const CHIP_SHOW_LIMIT = 5;

function GraphFilterBar({
  graphs,
  excluded,
  onToggle
}: {
  graphs: string[];
  excluded: Set<string>;
  onToggle: (graph: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (graphs.length === 0) return null;

  const visible = expanded ? graphs : graphs.slice(0, CHIP_SHOW_LIMIT);
  const hidden = graphs.length - CHIP_SHOW_LIMIT;

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-gray-200 bg-gray-50 text-[0.68rem]">
      <span className="text-gray-400 font-medium shrink-0">Graphs:</span>
      {visible.map((g) => {
        const isExcluded = excluded.has(g);
        return (
          <button
            key={g}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors ${
              isExcluded
                ? "bg-gray-100 border-gray-300 text-gray-400 line-through"
                : "bg-white border-blue-300 text-blue-700 hover:bg-blue-50"
            }`}
            title={isExcluded ? `Click to re-include: ${g}` : `Click to exclude: ${g}`}
            onClick={() => onToggle(g)}
          >
            {isExcluded ? <i className="ri-eye-off-line text-[0.6rem]" /> : <i className="ri-eye-line text-[0.6rem]" />}
            {graphLabel(g)}
          </button>
        );
      })}
      {!expanded && hidden > 0 && (
        <button
          className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
          onClick={() => setExpanded(true)}
        >
          +{hidden} more
        </button>
      )}
      {expanded && hidden > 0 && (
        <button
          className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  );
}

export function SubjectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const uri = searchParams.get("uri") ?? "";
  const breadcrumbs: string[] = (location.state as { breadcrumbs?: string[] } | null)?.breadcrumbs ?? [];

  const { settings, isLoaded } = useSettings();
  const [endpointUrl, setEndpointUrl] = useState("");
  const [showGraphs, setShowGraphs] = useState(false);
  const [excludedGraphs, setExcludedGraphs] = useState<Set<string>>(loadExcludedGraphs);

  useEffect(() => {
    if (!isLoaded) return;
    endpointStore.get(settings.activeEndpointId).then((ep) => setEndpointUrl(ep?.url ?? ""));
  }, [isLoaded, settings.activeEndpointId]);

  const outgoing = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const incoming = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);

  useEffect(() => {
    if (!isLoaded || !uri || !endpointUrl) return;
    if (showGraphs) {
      void Promise.all([
        outgoing.run(`SELECT DISTINCT ?p ?o ?g WHERE { GRAPH ?g { <${uri}> ?p ?o } }`),
        incoming.run(`SELECT DISTINCT ?s ?p ?g WHERE { GRAPH ?g { ?s ?p <${uri}> } }`)
      ]);
    } else {
      void Promise.all([
        outgoing.run(`SELECT DISTINCT ?p ?o WHERE { <${uri}> ?p ?o }`),
        incoming.run(`SELECT DISTINCT ?s ?p WHERE { ?s ?p <${uri}> }`)
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, uri, endpointUrl, showGraphs]);

  function toggleExcludedGraph(graph: string) {
    setExcludedGraphs((prev) => {
      const next = new Set(prev);
      if (next.has(graph)) next.delete(graph);
      else next.add(graph);
      saveExcludedGraphs(next);
      return next;
    });
  }

  function renderSection(
    label: string,
    query: ReturnType<typeof useExecuteQuery>
  ) {
    const graphs = uniqueGraphs(query.result);
    const filtered = query.result ? filterByGraph(query.result, excludedGraphs) : null;
    const shownCount = filtered?.results.bindings.length ?? null;
    const totalCount = query.result?.results.bindings.length ?? null;
    const hiddenCount = totalCount !== null && shownCount !== null ? totalCount - shownCount : 0;

    return (
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col min-h-0">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg m-0 flex items-center gap-2">
          <span className="flex-1">{label}</span>
          {hiddenCount > 0 && (
            <span className="text-[0.68rem] font-normal text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              {hiddenCount} hidden by graph filter
            </span>
          )}
        </h2>
        {showGraphs && graphs.length > 0 && (
          <GraphFilterBar graphs={graphs} excluded={excludedGraphs} onToggle={toggleExcludedGraph} />
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {query.isRunning && <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>}
          {!query.isRunning && query.error && (
            <p className="px-4 py-3 text-red-600 text-sm">{query.error}</p>
          )}
          {!query.isRunning && !query.error && filtered && filtered.results.bindings.length === 0 && (
            <p className="px-4 py-3 text-gray-500 text-sm">
              {hiddenCount > 0 ? "All triples are filtered out by graph exclusions." : "No results."}
            </p>
          )}
          {!query.isRunning && !query.error && filtered && filtered.results.bindings.length > 0 && (
            <ResultsTable result={filtered} onNavigateToSubject={handleNavigateToSubject} />
          )}
          {!query.isRunning && !query.error && !query.result && !uri && (
            <p className="px-4 py-3 text-gray-500 text-sm">No subject URI provided.</p>
          )}
        </div>
      </section>
    );
  }

  function handleNavigateToSubject(targetUri: string) {
    navigate("/subject?uri=" + encodeURIComponent(targetUri), {
      state: { breadcrumbs: [...breadcrumbs, uri] }
    });
  }

  function handleBreadcrumbClick(index: number) {
    navigate("/subject?uri=" + encodeURIComponent(breadcrumbs[index]), {
      state: { breadcrumbs: breadcrumbs.slice(0, index) }
    });
  }

  const outgoingCount = outgoing.result ? filterByGraph(outgoing.result, excludedGraphs).results.bindings.length : null;
  const incomingCount = incoming.result ? filterByGraph(incoming.result, excludedGraphs).results.bindings.length : null;
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
        <button
          className={`btn-dark text-xs shrink-0 ${showGraphs ? "ring-1 ring-blue-400 text-blue-300" : ""}`}
          onClick={() => setShowGraphs((v) => !v)}
          title={showGraphs
            ? "Graph mode on — queries include ?g column. Note: triples in the default graph are not shown in this mode."
            : "Show which named graph each triple belongs to (re-runs queries)"}
        >
          <i className="ri-node-tree" /> {showGraphs ? "Graphs on" : "Show graphs"}
        </button>
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1 bg-[#2a2a2a] text-xs text-[#9ca3af] shrink-0 border-b border-[#333] overflow-hidden">
          <button
            className="hover:text-white shrink-0"
            title="Back to query results"
            onClick={() => navigate(-breadcrumbs.length - 1)}
          >
            <i className="ri-home-4-line" />
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb + i} className="flex items-center gap-1 min-w-0">
              <i className="ri-arrow-right-s-line text-[#555] shrink-0" />
              <button
                className="hover:text-white truncate max-w-[160px]"
                title={crumb}
                onClick={() => handleBreadcrumbClick(i)}
              >
                {shortLabel(crumb)}
              </button>
            </span>
          ))}
          <i className="ri-arrow-right-s-line text-[#555] shrink-0" />
          <span className="text-white truncate" title={uri}>
            {shortLabel(uri)}
          </span>
        </div>
      )}

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
