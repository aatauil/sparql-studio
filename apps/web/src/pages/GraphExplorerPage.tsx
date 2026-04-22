import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { compressUri, shortLabel, getBindingValue } from "../query-utils";
import { BridgeClient } from "../bridge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "../sparql-fetch";
import type { BridgeResponse, SparqlJsonResult } from "@sparql-studio/contracts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
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
    <section className="border border-gray-200 bg-white shadow-sm flex flex-col min-h-0 flex-1">
      <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 m-0 flex items-center gap-2">
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
          <Table>
            <TableHeader>
              <TableRow className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <TableHead className="px-4 py-2">Graph</TableHead>
                <TableHead className="px-4 py-2 text-right w-32">Triples</TableHead>
                <TableHead className="px-4 py-2 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const g = getBindingValue(row, "g");
                const triples = parseInt(getBindingValue(row, "triples"), 10);
                return (
                  <TableRow
                    key={g + i}
                    className="border-b border-border hover:bg-blue-50 cursor-pointer group transition-colors"
                    onClick={() => onSelectGraph(g)}
                  >
                    <TableCell className="px-4 py-2.5 font-mono text-xs text-gray-700 max-w-0 w-full">
                      <span className="block truncate" title={g}>{g}</span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                      {isNaN(triples) ? "—" : formatCount(triples)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <i className="ri-arrow-right-line text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
    <div className="flex items-center px-6 py-4 bg-white border border-gray-200 shadow-sm flex-1 min-w-0">
      <i className={`${icon} text-xl text-blue-400`} />
      <span className="text-2xl mx-2 font-semibold text-gray-800 tabular-nums">
        {value ?? <span className="text-gray-300 text-lg">…</span>}
      </span>
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ── Schema Explorer ───────────────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 36;                 // approx auto-height of a single-line node card
const COL_X_STEP = NODE_W + 80;   // horizontal distance between columns
const ROW_Y_STEP = NODE_H + 48;   // vertical distance between nodes in a column
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
  predicates?: string[];
  properties?: string[];
};

const ExplorerActionsContext = createContext<{
  collapse: (uri: string) => void;
  hide: (uri: string) => void;
} | null>(null);

function ExplorerNode({ data }: NodeProps) {
  const d = data as ExplorerNodeData;
  const actions = useContext(ExplorerActionsContext);

  if (d.isProxy) {
    return (
      <div
        title={`Click to focus: ${d.uri}`}
        style={{ width: NODE_W }}
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 shadow-none select-none cursor-pointer opacity-60 hover:opacity-80 transition-opacity"
      >
        <Handle type="target" position={Position.Left} style={{ background: "#9ca3af", width: 8, height: 8 }} />
        <div className="flex items-center gap-1.5">
          <i className="ri-crosshair-line text-gray-400 text-xs shrink-0" />
          <span className="font-medium text-gray-500 text-xs break-all flex-1">{d.label}</span>
        </div>
        {d.predicates && d.predicates.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {d.predicates.map((p) => (
              <span key={p} className="text-[0.6rem] text-gray-400 break-all" title={p}>{p}</span>
            ))}
          </div>
        )}
        <Handle type="source" position={Position.Right} style={{ background: "#9ca3af", width: 8, height: 8 }} />
      </div>
    );
  }

  return (
    <div
      title={d.uri}
      style={{ width: NODE_W }}
      className={`group/node rounded-lg border px-3 py-2 shadow-sm select-none transition-colors relative ${
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
      <div className="font-semibold text-gray-800 text-xs break-all pr-5">{d.label}</div>
      {d.loading && <div className="text-[0.65rem] text-blue-400 mt-0.5">Loading…</div>}
      {d.predicates && d.predicates.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {d.predicates.map((p) => (
            <span key={p} className="text-[0.6rem] text-gray-400 break-all" title={p}>{p}</span>
          ))}
        </div>
      )}
      {d.properties && d.properties.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-100 flex flex-col gap-0.5">
          {d.properties.map((p) => (
            <span key={p} className="text-[0.6rem] text-purple-400 break-all" title={p}>
              <i className="ri-price-tag-3-line mr-0.5" />{p}
            </span>
          ))}
        </div>
      )}
      {/* Node action buttons — visible on hover */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/node:opacity-100 transition-opacity">
        {d.expanded && !d.isStart && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Collapse"
            onClick={(e) => { e.stopPropagation(); actions?.collapse(d.uri); }}
          >
            <i className="ri-subtract-line text-[0.65rem]" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          title="Hide node"
          onClick={(e) => { e.stopPropagation(); actions?.hide(d.uri); }}
        >
          <i className="ri-eye-off-line text-[0.65rem]" />
        </Button>
      </div>
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
  const nodeDepthRef  = useRef(new Map<string, number>());
  const nodeParentRef = useRef(new Map<string, string>()); // child id → parent uri
  const colMaxYRef    = useRef(new Map<number, number>());
  const mountedRef    = useRef(true);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hiddenUris, setHiddenUris] = useState(new Set<string>());
  const hiddenUrisRef = useRef(hiddenUris);
  hiddenUrisRef.current = hiddenUris;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
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

  function displayLabel(uri: string): string {
    const compressed = compressUri(uri, displayPrefixesRef.current);
    if (compressed) return compressed;
    const afterHash = uri.split("#").pop() ?? "";
    const afterSlash = uri.split("/").pop() ?? "";
    const local = afterHash.length > 1 ? afterHash : afterSlash;
    return local.length > 0 ? local : uri;
  }

  function makeNode(uri: string, isStart: boolean, predicates: string[] = [], properties: string[] = []): Node {
    const instances = instanceMap.get(uri);
    return {
      id: uri,
      type: "explorerNode",
      position: { x: 0, y: 0 },
      data: {
        label: displayLabel(uri),
        uri,
        instances: instances != null ? formatCount(instances) : null,
        expanded: false,
        loading: false,
        isStart,
        highlighted: false,
        isProxy: false,
        predicates,
        properties,
      } satisfies ExplorerNodeData,
    };
  }

  function makeProxyNode(proxyId: string, targetUri: string, predicates: string[] = []): Node {
    return {
      id: proxyId,
      type: "explorerNode",
      position: { x: 0, y: 0 },
      data: {
        label: displayLabel(targetUri),
        uri: targetUri,
        instances: null,
        expanded: true,
        loading: false,
        isStart: false,
        highlighted: false,
        isProxy: true,
        proxyTargetUri: targetUri,
        predicates,
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
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      highlightTimeoutRef.current = null;
      setNodes((nds) =>
        nds.map((n) => n.id === targetUri ? { ...n, data: { ...n.data, highlighted: false } } : n)
      );
    }, 1500);
  }

  function collapseNode(typeUri: string) {
    // Collect all descendant node ids recursively
    const toRemove = new Set<string>();
    function collectDescendants(parentId: string) {
      for (const [child, parent] of nodeParentRef.current) {
        if (parent === parentId && !toRemove.has(child)) {
          toRemove.add(child);
          expandedRef.current.delete(child);
          collectDescendants(child);
        }
      }
    }
    collectDescendants(typeUri);
    expandedRef.current.delete(typeUri);
    for (const id of toRemove) nodeParentRef.current.delete(id);

    const remaining = nodesRef.current.filter((n) => !toRemove.has(n.id));
    setNodes(remaining.map((n) =>
      n.id === typeUri ? { ...n, data: { ...n.data, expanded: false } } : n
    ));
    setEdges(edgesRef.current.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target)));
  }

  function hideNode(uri: string) {
    setHiddenUris((prev) => new Set([...prev, uri]));
  }

  function unhideNode(uri: string) {
    setHiddenUris((prev) => { const s = new Set(prev); s.delete(uri); return s; });
  }

  function unhideAll() {
    setHiddenUris(new Set());
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

    const propsQuery = [
      `SELECT DISTINCT ?predicate`,
      `WHERE {`,
      `  GRAPH <${graphUri}> {`,
      `    ?s a <${typeUri}> .`,
      `    ?s ?predicate ?val .`,
      `    FILTER(isLiteral(?val))`,
      `  }`,
      `}`,
      `LIMIT 20`,
    ].join("\n");

    const [response, propsResponse] = await Promise.all([
      executeRef.current(query),
      executeRef.current(propsQuery),
    ]);
    if (!mountedRef.current) return;

    const typeProperties: string[] = propsResponse.ok
      ? propsResponse.data.results.bindings
          .map((row) => getBindingValue(row, "predicate"))
          .filter(Boolean)
          .map((pred) => displayLabel(pred))
      : [];

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
      const newRealUrisSet = new Set<string>();
      const proxyEntries: Array<{ proxyId: string; targetUri: string }> = [];
      const addedProxyIds = new Set<string>();
      for (const row of rows) {
        const other = getBindingValue(row, "otherType");
        if (!other) continue;
        if (existingRealUris.has(other)) {
          const proxyId = `proxy::${typeUri}::${other}`;
          if (!addedProxyIds.has(proxyId)) {
            addedProxyIds.add(proxyId);
            proxyEntries.push({ proxyId, targetUri: other });
          }
        } else if (!newRealUrisSet.has(other)) {
          newRealUrisSet.add(other);
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

      // Track parent relationships for collapse support
      for (const id of allNewIds) nodeParentRef.current.set(id, typeUri);

      // Collect predicates per connected node (to render inside the node card)
      const predicatesByNode = new Map<string, string[]>();
      for (const row of rows) {
        const pred = getBindingValue(row, "predicate");
        const other = getBindingValue(row, "otherType");
        if (!pred || !other) continue;
        const resolvedOther = proxyIdByTarget.get(other) ?? other;
        const predLabel = displayLabel(pred);
        if (!predicatesByNode.has(resolvedOther)) predicatesByNode.set(resolvedOther, []);
        const list = predicatesByNode.get(resolvedOther)!;
        if (!list.includes(predLabel)) list.push(predLabel);
      }

      // Build clean edges — one per (source, target) pair, no labels
      const existingEdgeIds = new Set(edgesRef.current.map((e) => e.id));
      const newEdges: Edge[] = [];
      for (const row of rows) {
        const dir = getBindingValue(row, "direction");
        const pred = getBindingValue(row, "predicate");
        const other = getBindingValue(row, "otherType");
        if (!pred || !other) continue;
        const resolvedOther = proxyIdByTarget.get(other) ?? other;
        const source = dir === "out" ? typeUri : resolvedOther;
        const target = dir === "out" ? resolvedOther : typeUri;
        const edgeId = `${source}::${target}`;
        if (existingEdgeIds.has(edgeId)) continue;
        existingEdgeIds.add(edgeId);
        newEdges.push({
          id: edgeId,
          source,
          target,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af" },
          style: { stroke: "#9ca3af", strokeWidth: 1.5 },
        });
      }
      const allEdges = [...edgesRef.current, ...newEdges];

      const allNodes: Node[] = [
        // Existing nodes: update data only — positions stay exactly as-is;
        // accumulate any new predicates if this node gets additional edges
        ...nodesRef.current.map((n) => {
          if (n.id === typeUri) return { ...n, data: { ...n.data, loading: false, expanded: true, properties: typeProperties } };
          const newPreds = predicatesByNode.get(n.id);
          if (!newPreds) return n;
          const existing = (n.data as ExplorerNodeData).predicates ?? [];
          const merged = [...existing, ...newPreds.filter((p) => !existing.includes(p))];
          return { ...n, data: { ...n.data, predicates: merged } };
        }),
        ...newRealUris.map((uri) => ({
          ...makeNode(uri, false, predicatesByNode.get(uri) ?? []),
          position: positions.get(uri)!,
        })),
        ...proxyEntries.map((p) => ({
          ...makeProxyNode(p.proxyId, p.targetUri, predicatesByNode.get(p.proxyId) ?? []),
          position: positions.get(p.proxyId)!,
        })),
      ];

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
    nodeParentRef.current = new Map();
    colMaxYRef.current   = new Map([[0, NODE_H]]);
    setHiddenUris(new Set());
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

  const visibleNodes = nodes.filter((n) => !hiddenUris.has(n.id));
  const visibleEdges = edges.filter((e) => !hiddenUris.has(e.source) && !hiddenUris.has(e.target));

  // Build list of hidden node labels for the unhide panel
  const hiddenList = useMemo(() => {
    return [...hiddenUris].map((uri) => {
      const node = nodesRef.current.find((n) => n.id === uri);
      const label = node ? (node.data as ExplorerNodeData).label : (compressUri(uri, displayPrefixesRef.current) ?? shortLabel(uri));
      return { uri, label };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenUris]);

  return (
    <ExplorerActionsContext.Provider value={{ collapse: collapseNode, hide: hideNode }}>
      <div className="relative h-full w-full">
        <ReactFlow
          className="explorer-flow h-full w-full"
          nodes={visibleNodes}
          edges={visibleEdges}
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
          <Background color="#94a3b8" gap={20} size={1.5} />
          <Controls />
        </ReactFlow>
        {hiddenList.length > 0 && (
          <div className="absolute top-2 right-2 z-10 bg-white border border-gray-200 shadow-md p-2 min-w-[160px] max-w-[240px]">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-xs font-semibold text-gray-600">{hiddenList.length} hidden</span>
              <Button
                variant="link"
                size="xs"
                className="shrink-0 h-auto p-0 text-[0.65rem]"
                onClick={unhideAll}
              >
                Unhide all
              </Button>
            </div>
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {hiddenList.map(({ uri, label }) => (
                <div key={uri} className="flex items-center gap-1 group">
                  <span className="text-[0.65rem] text-gray-500 truncate flex-1 min-w-0" title={uri}>{label}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Unhide"
                    className="shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={() => unhideNode(uri)}
                  >
                    <i className="ri-eye-line text-[0.65rem]" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ExplorerActionsContext.Provider>
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
      <section className="border border-gray-200 bg-white shadow-sm flex flex-col min-h-0 flex-1">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-gray-200 bg-gray-50 m-0 flex items-center gap-2">
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
            <Table>
              <TableHeader>
                <TableRow className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                  <TableHead className="px-4 py-2">Type</TableHead>
                  <TableHead className="px-4 py-2 text-right w-36">Instances</TableHead>
                  <TableHead className="px-4 py-2 w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {typeRows.map((row, i) => {
                  const type = getBindingValue(row, "type");
                  const instances = parseInt(getBindingValue(row, "instances"), 10);
                  return (
                    <TableRow
                      key={type + i}
                      className="border-b border-border group hover:bg-muted/50 transition-colors"
                    >
                      <TableCell className="px-4 py-2.5 max-w-0 w-full">
                        <span
                          className="block truncate font-mono text-xs text-gray-700"
                          title={type}
                        >
                          {compressUri(type, displayPrefixes) ?? shortLabel(type)}
                        </span>
                        <span
                          className="block truncate text-[0.65rem] text-muted-foreground mt-0.5"
                          title={type}
                        >
                          {type}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                        {isNaN(instances) ? "—" : formatCount(instances)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:bg-blue-100"
                            title="Explore data model"
                            onClick={(e) => {
                              e.stopPropagation();
                              onExploreModel(type);
                            }}
                          >
                            <i className="ri-node-tree text-sm" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400"
                            title="Browse instances"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToSubject(type);
                            }}
                          >
                            <i className="ri-list-unordered text-sm" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
  const instanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of typesQuery.result?.results.bindings ?? []) {
      const type = getBindingValue(row, "type");
      const count = parseInt(getBindingValue(row, "instances"), 10);
      if (type && !isNaN(count)) map.set(type, count);
    }
    return map;
  }, [typesQuery.result]);

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
        <div className="dark flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
          <Button variant="secondary" size="sm" onClick={handleBack} aria-label="Go back">
            <i className="ri-arrow-left-line" /> Back
          </Button>
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
            <div className="flex-1 min-h-0 border border-gray-200 bg-white shadow-sm overflow-hidden">
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
