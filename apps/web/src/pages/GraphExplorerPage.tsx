import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useSettings } from "../hooks/useSettings";
import { useExecuteQuery } from "../hooks/useBridgeQuery";
import { endpointStore } from "../storage";

function shortLabel(uri: string): string {
  const afterHash = uri.split("#").pop() ?? "";
  const afterSlash = uri.split("/").pop() ?? "";
  const local = afterHash.length > 1 ? afterHash : afterSlash;
  return local.length > 0 && local.length < 60 ? local : uri.slice(0, 50) + "…";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function getBindingValue(binding: Record<string, unknown>, key: string): string {
  const val = binding[key];
  if (val && typeof val === "object" && "value" in val) return String((val as { value: unknown }).value);
  return "";
}

// ── Graph List View ──────────────────────────────────────────────────────────

function GraphListView({
  query,
  onSelectGraph
}: {
  query: ReturnType<typeof useExecuteQuery>;
  onSelectGraph: (uri: string) => void;
}) {
  const rows = query.result?.results.bindings ?? [];
  const count = rows.length;

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col min-h-0 flex-1">
      <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg m-0 flex items-center gap-2">
        <i className="ri-stack-line text-gray-400" />
        <span className="flex-1">
          Named Graphs
          {!query.isRunning && query.result && (
            <span className="ml-2 font-normal text-gray-400 text-xs">· {count} found</span>
          )}
        </span>
      </h2>

      <div className="flex-1 min-h-0 overflow-auto">
        {query.isRunning && (
          <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>
        )}
        {!query.isRunning && query.error && (
          <p className="px-4 py-3 text-red-600 text-sm">{query.error}</p>
        )}
        {!query.isRunning && !query.error && query.result && count === 0 && (
          <p className="px-4 py-3 text-gray-500 text-sm">No named graphs found.</p>
        )}
        {!query.isRunning && !query.error && count > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Graph</th>
                <th className="px-4 py-2 font-medium text-right w-32">Triples</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const g = getBindingValue(row, "g");
                const triples = parseInt(getBindingValue(row, "triples"), 10);
                return (
                  <tr
                    key={g + i}
                    className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer group transition-colors"
                    onClick={() => onSelectGraph(g)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700 max-w-0 w-full">
                      <span className="block truncate" title={g}>{g}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums text-xs whitespace-nowrap">
                      {isNaN(triples) ? "—" : formatCount(triples)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <i className="ri-arrow-right-line text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!query.isRunning && !query.error && !query.result && (
          <p className="px-4 py-3 text-gray-400 text-sm">Waiting for endpoint…</p>
        )}
      </div>
    </section>
  );
}

// ── Stat Chip ────────────────────────────────────────────────────────────────

function StatChip({ label, value, icon }: { label: string; value: string | null; icon: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-4 bg-white rounded-lg border border-gray-200 shadow-sm flex-1 min-w-0">
      <i className={`${icon} text-xl text-blue-400`} />
      <span className="text-2xl font-semibold text-gray-800 tabular-nums">
        {value ?? <span className="text-gray-300 text-lg">…</span>}
      </span>
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ── Graph Detail View ─────────────────────────────────────────────────────────

function GraphDetailView({
  statsQuery,
  typesQuery,
  onNavigateToSubject
}: {
  statsQuery: ReturnType<typeof useExecuteQuery>;
  typesQuery: ReturnType<typeof useExecuteQuery>;
  onNavigateToSubject: (uri: string) => void;
}) {
  const statsRow = statsQuery.result?.results.bindings[0] ?? null;
  const triples = statsRow ? formatCount(parseInt(getBindingValue(statsRow, "triples"), 10)) : null;
  const subjects = statsRow ? formatCount(parseInt(getBindingValue(statsRow, "subjects"), 10)) : null;
  const predicates = statsRow ? formatCount(parseInt(getBindingValue(statsRow, "predicates"), 10)) : null;

  const typeRows = typesQuery.result?.results.bindings ?? [];
  const typeCount = typeRows.length;

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Stats strip */}
      <div className="flex gap-3 shrink-0">
        <StatChip label="Triples" value={triples} icon="ri-database-2-line" />
        <StatChip label="Subjects" value={subjects} icon="ri-file-list-3-line" />
        <StatChip label="Predicates" value={predicates} icon="ri-git-branch-line" />
      </div>

      {/* Types table */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col min-h-0 flex-1">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg m-0 flex items-center gap-2">
          <i className="ri-shapes-line text-gray-400" />
          <span className="flex-1">
            Types
            {!typesQuery.isRunning && typesQuery.result && (
              <span className="ml-2 font-normal text-gray-400 text-xs">· {typeCount} found</span>
            )}
          </span>
        </h2>

        <div className="flex-1 min-h-0 overflow-auto">
          {typesQuery.isRunning && (
            <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>
          )}
          {!typesQuery.isRunning && typesQuery.error && (
            <p className="px-4 py-3 text-red-600 text-sm">{typesQuery.error}</p>
          )}
          {!typesQuery.isRunning && !typesQuery.error && typesQuery.result && typeCount === 0 && (
            <p className="px-4 py-3 text-gray-500 text-sm">
              No typed resources found in this graph. Triples may not use <code className="bg-gray-100 px-1 rounded">rdf:type</code>.
            </p>
          )}
          {!typesQuery.isRunning && !typesQuery.error && typeCount > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right w-36">Instances</th>
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {typeRows.map((row, i) => {
                  const type = getBindingValue(row, "type");
                  const instances = parseInt(getBindingValue(row, "instances"), 10);
                  return (
                    <tr
                      key={type + i}
                      className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer group transition-colors"
                      onClick={() => onNavigateToSubject(type)}
                    >
                      <td className="px-4 py-2.5 max-w-0 w-full">
                        <span className="block truncate font-mono text-xs text-gray-700" title={type}>
                          {shortLabel(type)}
                        </span>
                        <span className="block truncate text-[0.65rem] text-gray-400 mt-0.5" title={type}>
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums text-xs whitespace-nowrap">
                        {isNaN(instances) ? "—" : formatCount(instances)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <i className="ri-arrow-right-line text-gray-300 group-hover:text-blue-500 transition-colors" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function GraphExplorerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const graphUri = searchParams.get("g") ?? null;

  const { settings, isLoaded } = useSettings();
  const [endpointUrl, setEndpointUrl] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    endpointStore.get(settings.activeEndpointId).then((ep) => setEndpointUrl(ep?.url ?? ""));
  }, [isLoaded, settings.activeEndpointId]);

  const graphListQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const statsQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const typesQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);

  useEffect(() => {
    if (!isLoaded || !endpointUrl) return;
    if (!graphUri) {
      void graphListQuery.run(
        `SELECT ?g (COUNT(*) AS ?triples) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?triples)`
      );
    } else {
      void statsQuery.run(
        `SELECT (COUNT(*) AS ?triples) (COUNT(DISTINCT ?s) AS ?subjects) (COUNT(DISTINCT ?p) AS ?predicates) WHERE { GRAPH <${graphUri}> { ?s ?p ?o } }`
      );
      void typesQuery.run(
        `SELECT ?type (COUNT(DISTINCT ?s) AS ?instances) WHERE { GRAPH <${graphUri}> { ?s a ?type } } GROUP BY ?type ORDER BY DESC(?instances)`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, endpointUrl, graphUri]);

  function handleSelectGraph(uri: string) {
    navigate("/graphs?g=" + encodeURIComponent(uri));
  }

  function handleNavigateToSubject(uri: string) {
    navigate("/subject?uri=" + encodeURIComponent(uri), { state: { breadcrumbs: [] } });
  }

  // Status bar message
  let statusMessage = "Ready.";
  if (!graphUri) {
    if (graphListQuery.isRunning) statusMessage = "Loading graphs…";
    else if (graphListQuery.result) {
      const n = graphListQuery.result.results.bindings.length;
      statusMessage = `${n} named graph${n !== 1 ? "s" : ""} found`;
    }
  } else {
    const running = statsQuery.isRunning || typesQuery.isRunning;
    if (running) statusMessage = "Loading…";
    else if (statsQuery.result && typesQuery.result) {
      const statsRow = statsQuery.result.results.bindings[0];
      const triples = statsRow ? parseInt(getBindingValue(statsRow, "triples"), 10) : 0;
      const types = typesQuery.result.results.bindings.length;
      statusMessage = `${formatCount(triples)} triples · ${types} type${types !== 1 ? "s" : ""}`;
    }
  }

  return (
    <main className="h-screen overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
        <button
          className="btn-dark"
          onClick={() => (graphUri ? navigate("/graphs") : navigate(-1))}
          aria-label="Go back"
        >
          <i className="ri-arrow-left-line" /> Back
        </button>
        <i className="ri-node-tree text-gray-400 shrink-0" />
        <span className="font-semibold text-white">Graph Explorer</span>
        {graphUri && (
          <span className="text-[#9ca3af] text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0" title={graphUri}>
            {graphUri}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden bg-gray-100">
        {!graphUri ? (
          <GraphListView query={graphListQuery} onSelectGraph={handleSelectGraph} />
        ) : (
          <GraphDetailView
            statsQuery={statsQuery}
            typesQuery={typesQuery}
            onNavigateToSubject={handleNavigateToSubject}
          />
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
  );
}
