import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Position,
  Handle,
  type NodeProps,
  MarkerType,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useActiveEndpoint } from "../hooks/useActiveEndpoint";
import { useExecuteQuery } from "../hooks/useBridgeQuery";
import { useHeapMemory } from "../hooks/useHeapMemory";
import { GRAPH_LIST_LIMIT, TYPES_LIMIT } from "../config";
import { DisplayPrefixContext, usePageDisplayPrefixes } from "../hooks/usePrefixManager";
import { compressUri } from "../query-utils";
import { BridgeClient } from "../bridge";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "../sparql-fetch";
import type { BridgeResponse, SparqlJsonResult } from "@sparql-studio/contracts";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  onSelectGraph,
}: {
  query: ReturnType<typeof useExecuteQuery>;
  onSelectGraph: (uri: string) => void;
}) {
  const rows = query.result?.results.bindings ?? [];
  const count = rows.length;
  const isCapped = count === GRAPH_LIST_LIMIT;

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
      {isCapped && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
          <i className="ri-alert-line" />
          Showing first {GRAPH_LIST_LIMIT.toLocaleString()} graphs. Your database may have more.
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {query.isRunning && <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>}
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

// ── Schema Explorer ───────────────────────────────────────────────────────────

const NODE_W = 190;
const NODE_H = 72;
const COL_X_STEP = NODE_W + 80;   // horizontal distance between columns
const ROW_Y_STEP = NODE_H + 24;   // vertical distance between nodes in a column
const TYPE_EXPANSION_LIMIT = 80;

type ExplorerNodeData = {
  label: string;
  uri: string;
  instances: string | null;
  expanded: boolean;
  loading: boolean;
  isStart: boolean;
  highlighted: boolean;
  isProxy: boolean;
  proxyTargetUri?: string;
};

function ExplorerNode({ data }: NodeProps) {
  const d = data as ExplorerNodeData;

  if (d.isProxy) {
    return (
      <div
        title={`Reference to: ${d.uri}`}
        style={{ width: NODE_W, minHeight: NODE_H }}
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 shadow-sm select-none cursor-alias"
      >
        <Handle type="target" position={Position.Left} style={{ background: "#d1d5db", width: 8, height: 8 }} />
        <div className="flex items-center gap-1">
          <i className="ri-focus-3-line text-gray-400 text-xs shrink-0" />
          <span className="font-medium text-gray-500 text-xs truncate">{d.label}</span>
        </div>
        <div className="text-[0.6rem] text-gray-400 mt-0.5">Click to focus original</div>
        <Handle type="source" position={Position.Right} style={{ background: "#d1d5db", width: 8, height: 8 }} />
      </div>
    );
  }

  return (
    <div
      title={d.uri}
      style={{ width: NODE_W, minHeight: NODE_H }}
      className={`rounded-lg border px-3 py-2 shadow-sm select-none transition-colors ${
        d.isStart
          ? "border-blue-500 bg-blue-50"
          : d.expanded
          ? "border-gray-300 bg-gray-50"
          : "border-gray-300 bg-white hover:border-blue-400 cursor-pointer"
      } ${d.loading ? "animate-pulse opacity-70" : ""} ${
        d.highlighted ? "ring-2 ring-blue-400 ring-offset-1" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} style={{ background: "#93c5fd", width: 8, height: 8 }} />
      <div className="font-semibold text-gray-800 text-xs truncate">{d.label}</div>
      {d.instances && (
        <div className="text-[0.65rem] text-gray-400 mt-0.5 tabular-nums">{d.instances} instances</div>
      )}
      {d.loading && <div className="text-[0.65rem] text-blue-400 mt-0.5">Loading…</div>}
      {!d.expanded && !d.loading && !d.isStart && (
        <div className="text-[0.6rem] text-gray-300 mt-0.5">Click to expand</div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: "#93c5fd", width: 8, height: 8 }} />
    </div>
  );
}

const explorerNodeTypes = { explorerNode: ExplorerNode };

type SchemaExplorerProps = {
  graphUri: string;
  startType: string;
  instanceMap: Map<string, number>;
  endpointUrl: string;
  timeoutMs: number;
  extensionId: string;
};

// Inner component — lives inside ReactFlowProvider so useReactFlow() works
function SchemaExplorerInner({
  graphUri,
  startType,
  instanceMap,
  endpointUrl,
  timeoutMs,
  extensionId,
}: SchemaExplorerProps) {
  const { setCenter, getNode } = useReactFlow();
  const displayPrefixes = useContext(DisplayPrefixContext);
  const displayPrefixesRef = useRef(displayPrefixes);
  displayPrefixesRef.current = displayPrefixes;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Refs so async callbacks always read the latest state without stale closures
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const expandedRef  = useRef(new Set<string>());
  // column layout state — depth per node, and the lowest bottom-edge per column
  const nodeDepthRef = useRef(new Map<string, number>());
  const colMaxYRef   = useRef(new Map<number, number>());
  const mountedRef   = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function placeInColumn(
    parentUri: string,
    newIds: string[]
  ): Map<string, { x: number; y: number }> {
    const result = new Map<string, { x: number; y: number }>();
    if (newIds.length === 0) return result;

    const parentNode    = nodesRef.current.find((n) => n.id === parentUri);
    const parentCenterY = (parentNode?.position.y ?? 0) + NODE_H / 2;
    const parentDepth   = nodeDepthRef.current.get(parentUri) ?? 0;
    const col           = parentDepth + 1;
    const x             = col * COL_X_STEP;

    // Center the group around the parent; push down if column is already occupied
    const groupH     = (newIds.length - 1) * ROW_Y_STEP;
    let   startY     = parentCenterY - groupH / 2 - NODE_H / 2;
    const prevBottom = colMaxYRef.current.get(col);
    if (prevBottom !== undefined && startY < prevBottom + 24) {
      startY = prevBottom + 24;
    }

    newIds.forEach((id, i) => {
      const y = startY + i * ROW_Y_STEP;
      result.set(id, { x, y });
      nodeDepthRef.current.set(id, col);
    });

    const newBottom = startY + (newIds.length - 1) * ROW_Y_STEP + NODE_H;
    colMaxYRef.current.set(col, Math.max(prevBottom ?? -Infinity, newBottom));
    return result;
  }

  type Executor = (query: string) => Promise<BridgeResponse<SparqlJsonResult>>;
  const executeRef = useRef<Executor | null>(null);
  useEffect(() => {
    const bridge = new BridgeClient(extensionId);
    const url = normalizeEndpointUrl(endpointUrl);
    executeRef.current = (query) =>
      isLocalhostUrl(url)
        ? bridge.executeQuery({ endpointUrl: url, timeoutMs, query })
        : directFetch(url, query, timeoutMs);
  }, [endpointUrl, timeoutMs, extensionId]);

  function makeNode(uri: string, isStart: boolean): Node {
    const instances = instanceMap.get(uri);
    return {
      id: uri,
      type: "explorerNode",
      position: { x: 0, y: 0 },
      data: {
        label: compressUri(uri, displayPrefixesRef.current) ?? shortLabel(uri),
        uri,
        instances: instances != null ? formatCount(instances) : null,
        expanded: false,
        loading: false,
        isStart,
        highlighted: false,
        isProxy: false,
      } satisfies ExplorerNodeData,
    };
  }

  function makeProxyNode(proxyId: string, targetUri: string): Node {
    return {
      id: proxyId,
      type: "explorerNode",
      position: { x: 0, y: 0 },
      data: {
        label: compressUri(targetUri, displayPrefixesRef.current) ?? shortLabel(targetUri),
        uri: targetUri,
        instances: null,
        expanded: true,
        loading: false,
        isStart: false,
        highlighted: false,
        isProxy: true,
        proxyTargetUri: targetUri,
      } satisfies ExplorerNodeData,
    };
  }

  function focusNode(targetUri: string) {
    const node = getNode(targetUri);
    if (!node) return;
    setCenter(
      node.position.x + NODE_W / 2,
      node.position.y + NODE_H / 2,
      { zoom: 1.4, duration: 600 }
    );
    setNodes((nds) =>
      nds.map((n) => n.id === targetUri ? { ...n, data: { ...n.data, highlighted: true } } : n)
    );
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => n.id === targetUri ? { ...n, data: { ...n.data, highlighted: false } } : n)
      );
    }, 1500);
  }

  async function expandType(typeUri: string) {
    if (expandedRef.current.has(typeUri) || !executeRef.current) return;
    expandedRef.current.add(typeUri);

    setNodes((nds) =>
      nds.map((n) => n.id === typeUri ? { ...n, data: { ...n.data, loading: true } } : n)
    );

    const query = [
      `SELECT ?direction ?predicate ?otherType (COUNT(*) AS ?links)`,
      `WHERE {`,
      `  GRAPH <${graphUri}> {`,
      `    {`,
      `      ?s a <${typeUri}> .`,
      `      ?s ?predicate ?t .`,
      `      ?t a ?otherType .`,
      `      BIND("out" AS ?direction)`,
      `    } UNION {`,
      `      ?s a ?otherType .`,
      `      ?s ?predicate ?t .`,
      `      ?t a <${typeUri}> .`,
      `      BIND("in" AS ?direction)`,
      `    }`,
      `  }`,
      `}`,
      `GROUP BY ?direction ?predicate ?otherType`,
      `ORDER BY ?direction DESC(?links)`,
      `LIMIT ${TYPE_EXPANSION_LIMIT}`,
    ].join("\n");

    const response = await executeRef.current(query);
    if (!mountedRef.current) return;

    if (response.ok) {
      const rows = response.data.results.bindings;

      // Real (non-proxy) URIs already on canvas
      const existingRealUris = new Set(
        nodesRef.current
          .filter((n) => !(n.data as ExplorerNodeData).isProxy)
          .map((n) => n.id)
      );

      // Classify each connected type: new real node vs proxy of existing
      const newRealUris: string[] = [];
      const proxyEntries: Array<{ proxyId: string; targetUri: string }> = [];
      for (const row of rows) {
        const other = getBindingValue(row, "otherType");
        if (!other) continue;
        if (existingRealUris.has(other)) {
          const proxyId = `proxy::${typeUri}::${other}`;
          if (!proxyEntries.some((p) => p.proxyId === proxyId))
            proxyEntries.push({ proxyId, targetUri: other });
        } else if (!newRealUris.includes(other)) {
          newRealUris.push(other);
        }
      }

      // Build proxy lookup for edge routing
      const proxyIdByTarget = new Map(proxyEntries.map((p) => [p.targetUri, p.proxyId]));

      // Place all new nodes in the next column, incrementally
      const allNewIds = [
        ...newRealUris,
        ...proxyEntries.map((p) => p.proxyId),
      ];
      const positions = placeInColumn(typeUri, allNewIds);

      const allNodes: Node[] = [
        // Existing nodes: update data only — positions stay exactly as-is
        ...nodesRef.current.map((n) =>
          n.id === typeUri ? { ...n, data: { ...n.data, loading: false, expanded: true } } : n
        ),
        ...newRealUris.map((uri) => ({ ...makeNode(uri, false), position: positions.get(uri)! })),
        ...proxyEntries.map((p) => ({ ...makeProxyNode(p.proxyId, p.targetUri), position: positions.get(p.proxyId)! })),
      ];

      // Build edges — route to proxy IDs when the real node already exists
      const existingEdgeIds = new Set(edgesRef.current.map((e) => e.id));
      const newEdges: Edge[] = [];
      for (const row of rows) {
        const dir = getBindingValue(row, "direction");
        const pred = getBindingValue(row, "predicate");
        const other = getBindingValue(row, "otherType");
        const links = getBindingValue(row, "links");
        if (!pred || !other) continue;
        // Use proxy ID if the other type was already on canvas
        const resolvedOther = proxyIdByTarget.get(other) ?? other;
        const source = dir === "out" ? typeUri : resolvedOther;
        const target = dir === "out" ? resolvedOther : typeUri;
        const edgeId = `${source}::${pred}::${target}`;
        if (existingEdgeIds.has(edgeId)) continue;
        existingEdgeIds.add(edgeId);
        const predLabel = compressUri(pred, displayPrefixesRef.current) ?? shortLabel(pred);
        newEdges.push({
          id: edgeId,
          source,
          target,
          label: links ? `${predLabel} (${links})` : predLabel,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af" },
          style: { stroke: "#9ca3af", strokeWidth: 1.5 },
          labelStyle: { fontSize: 10, fill: "#6b7280" },
          labelBgStyle: { fill: "white", fillOpacity: 0.85 },
        });
      }
      const allEdges = [...edgesRef.current, ...newEdges];

      setNodes(allNodes);
      setEdges(allEdges);
    } else {
      expandedRef.current.delete(typeUri);
      setNodes((nds) =>
        nds.map((n) => n.id === typeUri ? { ...n, data: { ...n.data, loading: false } } : n)
      );
    }
  }

  useEffect(() => {
    expandedRef.current  = new Set();
    nodeDepthRef.current = new Map([[startType, 0]]);
    colMaxYRef.current   = new Map([[0, NODE_H]]);
    setNodes([{ ...makeNode(startType, true), position: { x: 0, y: 0 } }]);
    setEdges([]);
    void expandType(startType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startType, graphUri]);

  function onNodeClick(_: React.MouseEvent, node: Node) {
    const d = node.data as ExplorerNodeData;
    if (d.isProxy && d.proxyTargetUri) {
      focusNode(d.proxyTargetUri);
      return;
    }
    if (!d.expanded && !d.loading) {
      void expandType(node.id);
    }
  }

  return (
    <ReactFlow
      className="explorer-flow h-full w-full"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={explorerNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.05}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background color="#e5e7eb" gap={20} />
      <Controls />
    </ReactFlow>
  );
}

// Thin shell — provides the ReactFlow context so SchemaExplorerInner can use useReactFlow()
function SchemaExplorerView(props: SchemaExplorerProps) {
  return (
    <ReactFlowProvider>
      <style>{`.explorer-flow .react-flow__node:not(.dragging){transition:transform 0.35s cubic-bezier(.25,.46,.45,.94)}`}</style>
      <SchemaExplorerInner {...props} />
    </ReactFlowProvider>
  );
}

// ── Graph Detail View ─────────────────────────────────────────────────────────

function GraphDetailView({
  statsQuery,
  typesQuery,
  onNavigateToSubject,
  onExploreModel,
}: {
  statsQuery: ReturnType<typeof useExecuteQuery>;
  typesQuery: ReturnType<typeof useExecuteQuery>;
  onNavigateToSubject: (uri: string) => void;
  onExploreModel: (uri: string) => void;
}) {
  const displayPrefixes = useContext(DisplayPrefixContext);
  const statsRow = statsQuery.result?.results.bindings[0] ?? null;
  const triples = statsRow ? formatCount(parseInt(getBindingValue(statsRow, "triples"), 10)) : null;
  const subjects = statsRow ? formatCount(parseInt(getBindingValue(statsRow, "subjects"), 10)) : null;
  const predicates = statsRow
    ? formatCount(parseInt(getBindingValue(statsRow, "predicates"), 10))
    : null;

  const typeRows = typesQuery.result?.results.bindings ?? [];
  const typeCount = typeRows.length;
  const typesCapped = typeCount === TYPES_LIMIT;

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
        {typesCapped && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
            <i className="ri-alert-line" />
            Showing first {TYPES_LIMIT.toLocaleString()} types. This graph may have more.
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {typesQuery.isRunning && <p className="px-4 py-3 text-gray-500 text-sm">Loading…</p>}
          {!typesQuery.isRunning && typesQuery.error && (
            <p className="px-4 py-3 text-red-600 text-sm">{typesQuery.error}</p>
          )}
          {!typesQuery.isRunning && !typesQuery.error && typesQuery.result && typeCount === 0 && (
            <p className="px-4 py-3 text-gray-500 text-sm">
              No typed resources found in this graph. Triples may not use{" "}
              <code className="bg-gray-100 px-1 rounded">rdf:type</code>.
            </p>
          )}
          {!typesQuery.isRunning && !typesQuery.error && typeCount > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right w-36">Instances</th>
                  <th className="px-4 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {typeRows.map((row, i) => {
                  const type = getBindingValue(row, "type");
                  const instances = parseInt(getBindingValue(row, "instances"), 10);
                  return (
                    <tr
                      key={type + i}
                      className="border-b border-gray-50 group hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 max-w-0 w-full">
                        <span
                          className="block truncate font-mono text-xs text-gray-700"
                          title={type}
                        >
                          {compressUri(type, displayPrefixes) ?? shortLabel(type)}
                        </span>
                        <span
                          className="block truncate text-[0.65rem] text-gray-400 mt-0.5"
                          title={type}
                        >
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums text-xs whitespace-nowrap">
                        {isNaN(instances) ? "—" : formatCount(instances)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-blue-100 text-blue-500"
                            title="Explore data model"
                            onClick={(e) => {
                              e.stopPropagation();
                              onExploreModel(type);
                            }}
                          >
                            <i className="ri-node-tree text-sm" />
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-400"
                            title="Browse instances"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToSubject(type);
                            }}
                          >
                            <i className="ri-list-unordered text-sm" />
                          </button>
                        </div>
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
  const navigate = useNavigate();
  const [graphUri, setGraphUri] = useState<string | null>(null);
  const [focusType, setFocusType] = useState<string | null>(null);
  const displayPrefixes = usePageDisplayPrefixes();

  const { settings, isLoaded, endpointUrl } = useActiveEndpoint();

  const graphListQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const statsQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const typesQuery = useExecuteQuery(endpointUrl, settings.timeoutMs, settings.extensionId);
  const heap = useHeapMemory();

  useEffect(() => {
    if (!isLoaded || !endpointUrl) return;
    if (!graphUri) {
      void graphListQuery.run(
        `SELECT ?g (COUNT(*) AS ?triples) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?triples) LIMIT ${GRAPH_LIST_LIMIT}`
      );
    } else {
      void statsQuery.run(
        `SELECT (COUNT(*) AS ?triples) (COUNT(DISTINCT ?s) AS ?subjects) (COUNT(DISTINCT ?p) AS ?predicates) WHERE { GRAPH <${graphUri}> { ?s ?p ?o } }`
      );
      void typesQuery.run(
        `SELECT ?type (COUNT(DISTINCT ?s) AS ?instances) WHERE { GRAPH <${graphUri}> { ?s a ?type } } GROUP BY ?type ORDER BY DESC(?instances) LIMIT ${TYPES_LIMIT}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, endpointUrl, graphUri]);

  function handleSelectGraph(uri: string) {
    setGraphUri(uri);
    setFocusType(null);
  }

  function handleNavigateToSubject(uri: string) {
    navigate("/subject?uri=" + encodeURIComponent(uri), {
      state: { breadcrumbs: [], origin: "/graphs", pinnedGraph: graphUri },
    });
  }

  function handleBack() {
    if (focusType) {
      setFocusType(null);
    } else if (graphUri) {
      setGraphUri(null);
    } else {
      navigate("/");
    }
  }

  // Instance counts pre-loaded by typesQuery — passed into the schema explorer
  const instanceMap = new Map<string, number>();
  for (const row of typesQuery.result?.results.bindings ?? []) {
    const type = getBindingValue(row, "type");
    const count = parseInt(getBindingValue(row, "instances"), 10);
    if (type && !isNaN(count)) instanceMap.set(type, count);
  }

  // Status bar
  const statusParts: string[] = [];
  if (focusType) {
    statusParts.push(`Model: ${compressUri(focusType, displayPrefixes) ?? shortLabel(focusType)}`);
  } else if (!graphUri) {
    if (graphListQuery.isRunning) statusParts.push("Loading graphs…");
    else if (graphListQuery.result) {
      const n = graphListQuery.result.results.bindings.length;
      statusParts.push(`${n} named graph${n !== 1 ? "s" : ""} found`);
    } else {
      statusParts.push("Ready.");
    }
  } else {
    const running = statsQuery.isRunning || typesQuery.isRunning;
    if (running) statusParts.push("Loading…");
    else if (statsQuery.result && typesQuery.result) {
      const statsRow = statsQuery.result.results.bindings[0];
      const triples = statsRow ? parseInt(getBindingValue(statsRow, "triples"), 10) : 0;
      const types = typesQuery.result.results.bindings.length;
      statusParts.push(
        `${formatCount(triples)} triples · ${types} type${types !== 1 ? "s" : ""}`
      );
    } else {
      statusParts.push("Ready.");
    }
  }
  if (heap) statusParts.push(`Heap: ${heap.usedMB} MB / ${heap.limitMB} MB`);

  return (
    <DisplayPrefixContext.Provider value={displayPrefixes}>
      <main className="h-screen overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
          <button className="btn-dark" onClick={handleBack} aria-label="Go back">
            <i className="ri-arrow-left-line" /> Back
          </button>
          <i className="ri-node-tree text-gray-400 shrink-0" />
          <span className="font-semibold text-white">Graph Explorer</span>
          {graphUri && (
            <span
              className="text-[#9ca3af] text-xs overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
              style={
                focusType
                  ? ({ flex: "0 0 auto", maxWidth: "35%" } as React.CSSProperties)
                  : ({ flex: "1 1 0" } as React.CSSProperties)
              }
              title={graphUri}
            >
              {graphUri}
            </span>
          )}
          {focusType && (
            <>
              <i className="ri-arrow-right-s-line text-gray-600 shrink-0" />
              <span
                className="text-white text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0"
                title={focusType}
              >
                {compressUri(focusType, displayPrefixes) ?? shortLabel(focusType)}
              </span>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden bg-gray-100">
          {!graphUri && (
            <GraphListView query={graphListQuery} onSelectGraph={handleSelectGraph} />
          )}
          {graphUri && !focusType && (
            <GraphDetailView
              statsQuery={statsQuery}
              typesQuery={typesQuery}
              onNavigateToSubject={handleNavigateToSubject}
              onExploreModel={setFocusType}
            />
          )}
          {graphUri && focusType && (
            <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <SchemaExplorerView
                graphUri={graphUri}
                startType={focusType}
                instanceMap={instanceMap}
                endpointUrl={endpointUrl}
                timeoutMs={settings.timeoutMs}
                extensionId={settings.extensionId}
              />
            </div>
          )}
        </div>

        {/* Status bar */}
        <div
          className="shrink-0 bg-[#007acc] text-white text-[0.72rem] px-3 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
          role="status"
        >
          {statusParts.join(" | ")}
        </div>
      </main>
    </DisplayPrefixContext.Provider>
  );
}
