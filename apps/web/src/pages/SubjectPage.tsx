import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useActiveEndpoint } from "../hooks/useActiveEndpoint";
import { useExecuteQuery } from "../hooks/useBridgeQuery";
import { ResultsTable } from "../components/ResultsTable";
import { useHeapMemory } from "../hooks/useHeapMemory";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { SUBJECT_LIMIT, EXCLUDED_GRAPHS_KEY } from "../config";
import { usePageDisplayPrefixes, DisplayPrefixContext } from "../hooks/usePrefixManager";
import { shortLabel } from "../query-utils";
import { Button } from "../components/ui/button";

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
          <Button
            key={g}
            variant="outline"
            size="xs"
            className={isExcluded
              ? "bg-gray-100 border-gray-300 text-gray-400 line-through"
              : "bg-white border-blue-300 text-blue-700 hover:bg-blue-50"}
            title={isExcluded ? `Click to re-include: ${g}` : `Click to exclude: ${g}`}
            onClick={() => onToggle(g)}
          >
            {isExcluded ? <i className="ri-eye-off-line text-[0.6rem]" /> : <i className="ri-eye-line text-[0.6rem]" />}
            {graphLabel(g)}
          </Button>
        );
      })}
      {!expanded && hidden > 0 && (
        <Button variant="outline" size="xs" onClick={() => setExpanded(true)}>
          +{hidden} more
        </Button>
      )}
      {expanded && hidden > 0 && (
        <Button variant="outline" size="xs" onClick={() => setExpanded(false)}>
          Show less
        </Button>
      )}
    </div>
  );
}

export function SubjectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const uri = searchParams.get("uri") ?? "";
  type NavState = { breadcrumbs?: string[]; origin?: string; pinnedGraph?: string } | null;
  const breadcrumbs: string[] = (location.state as NavState)?.breadcrumbs ?? [];
  const origin: string = (location.state as NavState)?.origin ?? "/";
  const pinnedGraph: string | null = (location.state as NavState)?.pinnedGraph ?? null;

  const { settings, isLoaded, endpointUrl } = useActiveEndpoint();
  const displayPrefixes = usePageDisplayPrefixes();
  const [showGraphs, setShowGraphs] = useState(false);
  const [excludedGraphs, setExcludedGraphs] = useState<Set<string>>(loadExcludedGraphs);
  const [collapsedOutgoing, setCollapsedOutgoing] = useState(false);
  const [collapsedIncoming, setCollapsedIncoming] = useState(false);

  const outgoing = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const incoming = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);

  useEffect(() => {
    if (!isLoaded || !uri || !endpointUrl) return;
    if (pinnedGraph) {
      void Promise.all([
        outgoing.run(`SELECT DISTINCT ?p ?o WHERE { GRAPH <${pinnedGraph}> { <${uri}> ?p ?o } } LIMIT ${SUBJECT_LIMIT}`),
        incoming.run(`SELECT DISTINCT ?s ?p WHERE { GRAPH <${pinnedGraph}> { ?s ?p <${uri}> } } LIMIT ${SUBJECT_LIMIT}`)
      ]);
    } else if (showGraphs) {
      void Promise.all([
        outgoing.run(`SELECT DISTINCT ?p ?o ?g WHERE { GRAPH ?g { <${uri}> ?p ?o } } LIMIT ${SUBJECT_LIMIT}`),
        incoming.run(`SELECT DISTINCT ?s ?p ?g WHERE { GRAPH ?g { ?s ?p <${uri}> } } LIMIT ${SUBJECT_LIMIT}`)
      ]);
    } else {
      void Promise.all([
        outgoing.run(`SELECT DISTINCT ?p ?o WHERE { <${uri}> ?p ?o } LIMIT ${SUBJECT_LIMIT}`),
        incoming.run(`SELECT DISTINCT ?s ?p WHERE { ?s ?p <${uri}> } LIMIT ${SUBJECT_LIMIT}`)
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, uri, endpointUrl, showGraphs, pinnedGraph]);

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
    direction: "outgoing" | "incoming",
    query: ReturnType<typeof useExecuteQuery>,
    collapsed: boolean,
    onToggleCollapse: () => void
  ) {
    const isOutgoing = direction === "outgoing";
    const graphs = uniqueGraphs(query.result);
    const filtered = query.result ? filterByGraph(query.result, excludedGraphs) : null;
    const shownCount = filtered?.results.bindings.length ?? null;
    const totalCount = query.result?.results.bindings.length ?? null;
    const hiddenCount = totalCount !== null && shownCount !== null ? totalCount - shownCount : 0;
    const isCapped = totalCount === SUBJECT_LIMIT;

    const icon = isOutgoing ? "ri-arrow-right-circle-line" : "ri-arrow-left-circle-line";
    const iconColor = isOutgoing ? "text-blue-500" : "text-violet-500";
    const dirLabel = isOutgoing ? "Outgoing" : "Incoming";
    const pattern = isOutgoing ? "<subject> ?p ?o" : "?s ?p <subject>";

    return (
      <section className={`${collapsed ? "shrink-0" : "flex-1 min-h-0"} border border-gray-200 bg-white shadow-sm flex flex-col`}>
        <h2 className="text-sm font-semibold px-4 py-2.5 border-b border-gray-200 bg-gray-50 m-0 flex items-center gap-2 shrink-0 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={onToggleCollapse}>
          <i className={`${icon} ${iconColor} text-base shrink-0`} />
          <span>{dirLabel}</span>
          {!collapsed && <span className="font-normal text-gray-400 text-[0.7rem] font-mono">{pattern}</span>}
          <span className="flex-1" />
          {!collapsed && hiddenCount > 0 && (
            <span className="text-[0.68rem] font-normal text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              {hiddenCount} hidden
            </span>
          )}
          {!collapsed && shownCount !== null && !query.isRunning && (
            <span className="text-[0.68rem] font-normal text-gray-400 tabular-nums">
              {shownCount.toLocaleString()} triple{shownCount !== 1 ? "s" : ""}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-1 text-gray-400 hover:text-gray-600"
            title={collapsed ? `Expand ${dirLabel}` : `Collapse ${dirLabel}`}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          >
            <i className={`${collapsed ? "ri-expand-vertical-line" : "ri-collapse-vertical-line"} text-sm`} />
          </Button>
        </h2>
        {!collapsed && isCapped && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs shrink-0">
            <i className="ri-alert-line" />
            Showing first {SUBJECT_LIMIT.toLocaleString()} triples — use the query editor for full results.
          </div>
        )}
        {!collapsed && showGraphs && graphs.length > 0 && (
          <GraphFilterBar graphs={graphs} excluded={excludedGraphs} onToggle={toggleExcludedGraph} />
        )}
        {!collapsed && (
          <div className="flex-1 min-h-0 overflow-auto">
            {query.isRunning && (
              <div className="flex items-center gap-2 justify-center py-8 text-gray-400 text-sm">
                <i className="ri-loader-4-line animate-spin" /> Loading…
              </div>
            )}
            {!query.isRunning && query.error && (
              <p className="px-4 py-3 text-red-600 text-sm">{query.error}</p>
            )}
            {!query.isRunning && !query.error && filtered && filtered.results.bindings.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-gray-300">
                <i className={`${icon} text-3xl`} />
                <span className="text-sm text-gray-400">
                  {hiddenCount > 0 ? "All triples hidden by graph filter." : `No ${dirLabel.toLowerCase()} triples.`}
                </span>
              </div>
            )}
            {!query.isRunning && !query.error && filtered && filtered.results.bindings.length > 0 && (
              <ResultsTable result={filtered} onNavigateToSubject={handleNavigateToSubject} />
            )}
          </div>
        )}
      </section>
    );
  }

  function handleNavigateToSubject(targetUri: string) {
    navigate("/subject?uri=" + encodeURIComponent(targetUri), {
      state: { breadcrumbs: [...breadcrumbs, uri], origin, pinnedGraph }
    });
  }

  function handleBreadcrumbClick(index: number) {
    navigate("/subject?uri=" + encodeURIComponent(breadcrumbs[index]), {
      state: { breadcrumbs: breadcrumbs.slice(0, index), origin, pinnedGraph }
    });
  }

  const heap = useHeapMemory();
  const outgoingCount = outgoing.result ? filterByGraph(outgoing.result, excludedGraphs).results.bindings.length : null;
  const incomingCount = incoming.result ? filterByGraph(incoming.result, excludedGraphs).results.bindings.length : null;
  const statusParts: string[] = [];
  if (outgoingCount !== null) statusParts.push(`Outgoing: ${outgoingCount} triple${outgoingCount !== 1 ? "s" : ""}`);
  if (incomingCount !== null) statusParts.push(`Incoming: ${incomingCount} triple${incomingCount !== 1 ? "s" : ""}`);
  if (heap) statusParts.push(`Heap: ${heap.usedMB} MB / ${heap.limitMB} MB`);
  const statusMessage = statusParts.length > 0 ? statusParts.join(" | ") : (outgoing.isRunning || incoming.isRunning ? "Loading…" : "Ready.");

  return (
    <DisplayPrefixContext.Provider value={displayPrefixes}>
    <main className="h-screen overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="dark flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (breadcrumbs.length > 0) {
              navigate("/subject?uri=" + encodeURIComponent(breadcrumbs[breadcrumbs.length - 1]), {
                state: { breadcrumbs: breadcrumbs.slice(0, -1), origin, pinnedGraph }
              });
            } else {
              navigate(origin);
            }
          }}
          aria-label="Go back"
        >
          <i className="ri-arrow-left-line" /> Back
        </Button>
        <span className="font-semibold text-white">Subject</span>
        {pinnedGraph && (
          <span
            className="flex items-center gap-1 text-[#6b7280] text-xs shrink-0 border border-[#444] rounded px-2 py-0.5 bg-[#2a2a2a]"
            title={pinnedGraph}
          >
            <i className="ri-stack-line text-[10px]" />
            {pinnedGraph.length > 50 ? pinnedGraph.slice(0, 48) + "…" : pinnedGraph}
          </span>
        )}
        <span className="text-[#9ca3af] text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
          {uri || "—"}
        </span>
        {!pinnedGraph && (
          <Button
            variant="secondary"
            size="sm"
            className={`shrink-0 ${showGraphs ? "ring-1 ring-blue-400 text-blue-300" : ""}`}
            onClick={() => setShowGraphs((v) => !v)}
            title={showGraphs
              ? "Graph mode on — queries include ?g column. Note: triples in the default graph are not shown in this mode."
              : "Show which named graph each triple belongs to (re-runs queries)"}
          >
            <i className="ri-node-tree" /> {showGraphs ? "Graphs on" : "Show graphs"}
          </Button>
        )}
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="dark flex items-center gap-1 px-3 py-1.5 bg-[#1e1e1e] text-xs shrink-0 border-b border-[#333] overflow-x-auto">
          {/* Home pill */}
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            title="Back to origin"
            onClick={() => navigate(origin)}
          >
            <i className="ri-home-4-line text-[10px]" />
          </Button>

          {breadcrumbs.map((crumb, i) => (
            <span key={crumb + i} className="flex items-center gap-1 min-w-0">
              <i className="ri-arrow-right-s-line text-[#444] shrink-0" />
              {/* Visited (non-active ancestor) pill */}
              <Button
                variant="outline"
                size="xs"
                className="truncate max-w-[140px] text-muted-foreground"
                title={crumb}
                onClick={() => handleBreadcrumbClick(i)}
              >
                {shortLabel(crumb)}
              </Button>
            </span>
          ))}

          <i className="ri-arrow-right-s-line text-[#444] shrink-0" />

          {/* Active (current) pill */}
          <span
            className="flex items-center px-2 py-0.5 rounded-sm bg-[#1d3a5f] text-[#93c5fd] border border-[#2d5a8e] truncate max-w-[200px] font-medium"
            title={uri}
          >
            {shortLabel(uri)}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-hidden bg-gray-100">
        {!uri ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            No subject URI provided.
          </div>
        ) : (
          <>
            {renderSection("outgoing", outgoing, collapsedOutgoing, () => setCollapsedOutgoing((v) => !v))}
            {renderSection("incoming", incoming, collapsedIncoming, () => setCollapsedIncoming((v) => !v))}
          </>
        )}
      </div>

      {/* Status bar */}
      <div
        className="shrink-0 bg-[#007acc] text-white text-[0.72rem] px-3 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
        role="status"
      >
        {statusMessage}
      </div>
    </main>
    </DisplayPrefixContext.Provider>
  );
}
