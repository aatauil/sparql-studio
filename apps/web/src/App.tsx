import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BridgeClient } from "./bridge";
import {
  endpointStore,
  prefixStore,
  queryStore,
  settingsStore,
  type EndpointEntry,
  type PrefixEntry,
  type QueryHistoryEntry,
  type ResultMeta,
  type SavedQuery
} from "./storage";
import { createSparqlEditor } from "sparql-editor";
import { prefixCompletion } from "./extensions/prefixCompletion";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "./sparql-fetch";
import { SplitLayout } from "./SplitLayout";
import { useSettings, defaultSettings } from "./hooks/useSettings";
import { useHistoryManager } from "./hooks/useHistoryManager";
import { useHeapMemory } from "./hooks/useHeapMemory";
import { ResultsPanel } from "./components/ResultsPanel";
import { LeftPanel } from "./components/HistorySidebar";
import { EndpointPicker } from "./components/EndpointPicker";
import { LocalhostBridgeModal } from "./components/LocalhostBridgeModal";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";

const CURRENT_QUERY_KEY = "sparql-studio:currentQuery";
const ACTIVE_QUERY_KEY = "sparql-studio:activeQueryId";
const DEFAULT_QUERY = "SELECT * WHERE { ?s ?p ?o } LIMIT 25";
const IDB_RESULT_ROW_CAP = 5_000;

const defaultPrefixes: PrefixEntry[] = [
  { prefix: "rdf", iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", source: "local", updatedAt: Date.now(), enabled: true },
  { prefix: "rdfs", iri: "http://www.w3.org/2000/01/rdf-schema#", source: "local", updatedAt: Date.now(), enabled: true }
];

function uid() {
  return crypto.randomUUID();
}

function applyPrefixes(queryText: string, prefixes: PrefixEntry[]): string {
  const active = prefixes.filter((p) => p.enabled !== false);
  if (active.length === 0) return queryText;
  const prefixText = active.map((p) => `PREFIX ${p.prefix}: <${p.iri}>`).join("\n");
  return `${prefixText}\n${queryText}`.trim();
}


function SparqlEditorSurface({
  value,
  onChange,
  onAddPrefix
}: {
  value: string;
  onChange: (next: string) => void;
  onAddPrefix?: (prefix: string, iri: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!ref.current || editorRef.current) {
      return;
    }
    const editor = createSparqlEditor({
      parent: ref.current,
      value,
      onChange: (next: string, view: unknown) => {
        editorRef.current = view;
        onChange(next);
      },
      extensions: [prefixCompletion(onAddPrefix)]
    });
    editorRef.current = editor;
  }, [onChange, value, onAddPrefix]);

  return <div className="editorHost" ref={ref} aria-label="SPARQL query editor" />;
}

function Modal({
  label,
  onClose,
  children
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-gray-900/45 grid place-items-center p-4 z-100"
      onClick={onClose}
    >
      <section
        className="w-full max-w-[560px] max-h-[80vh] overflow-y-auto bg-white border border-gray-300 rounded-xl p-4"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const { settings: loadedSettings, isLoaded: settingsLoaded } = useSettings();
  const { history, addEntry } = useHistoryManager();
  const [settings, setSettings] = useState(defaultSettings);
  const [endpoints, setEndpoints] = useState<EndpointEntry[]>([]);
  const [activeEndpointId, setActiveEndpointId] = useState<string>(defaultSettings.activeEndpointId);
  const [queryText, setQueryText] = useState(
    () => localStorage.getItem(CURRENT_QUERY_KEY) ?? DEFAULT_QUERY
  );
  const [activeQueryId, setActiveQueryId] = useState<string>(
    () => localStorage.getItem(ACTIVE_QUERY_KEY) ?? ""
  );
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [prefixes, setPrefixes] = useState<PrefixEntry[]>([]);
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready.");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [globalPrefixesOn, setGlobalPrefixesOn] = useState(
    () => localStorage.getItem("sparql-studio:prefixesOn") !== "false"
  );
  const [localhostModalOpen, setLocalhostModalOpen] = useState(false);
  const heap = useHeapMemory();
  const bridge = useMemo(() => new BridgeClient(settings.extensionId), [settings.extensionId]);

  // Refs to avoid stale closures in debounced callbacks
  const activeQueryIdRef = useRef(activeQueryId);
  useEffect(() => { activeQueryIdRef.current = activeQueryId; }, [activeQueryId]);
  const savedQueriesRef = useRef<SavedQuery[]>([]);
  useEffect(() => { savedQueriesRef.current = savedQueries; }, [savedQueries]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist current query text to localStorage + debounce-save to IDB
  useEffect(() => {
    localStorage.setItem(CURRENT_QUERY_KEY, queryText);
    const id = activeQueryIdRef.current;
    if (!id) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const now = Date.now();
      setSavedQueries((prev) =>
        prev.map((q) => (q.id === id ? { ...q, queryText, updatedAt: now } : q))
      );
      const q = savedQueriesRef.current.find((x) => x.id === id);
      if (q) void queryStore.upsert({ ...q, queryText, updatedAt: now });
    }, 500);
  }, [queryText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setLocalhostModalOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    setSettings(loadedSettings);
    setSettingsDraft(loadedSettings);
    setActiveEndpointId(loadedSettings.activeEndpointId);
  }, [settingsLoaded, loadedSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    (async () => {
      const prefixList = await prefixStore.list();
      if (prefixList.length === 0) {
        for (const prefix of defaultPrefixes) {
          await prefixStore.upsert(prefix);
        }
      }

      let queries = (await queryStore.list()).sort((a, b) => b.updatedAt - a.updatedAt);

      // Ensure there's always at least one query
      if (queries.length === 0) {
        const now = Date.now();
        const defaultQuery: SavedQuery = {
          id: uid(),
          title: "Untitled",
          queryText: localStorage.getItem(CURRENT_QUERY_KEY) ?? DEFAULT_QUERY,
          tags: [],
          createdAt: now,
          updatedAt: now
        };
        await queryStore.upsert(defaultQuery);
        queries = [defaultQuery];
      }

      setSavedQueries(queries);

      // Resolve which query is active
      const storedId = localStorage.getItem(ACTIVE_QUERY_KEY) ?? "";
      const active = queries.find((q) => q.id === storedId) ?? queries[0];
      setActiveQueryId(active.id);
      localStorage.setItem(ACTIVE_QUERY_KEY, active.id);
      setQueryText(active.queryText);
      localStorage.setItem(CURRENT_QUERY_KEY, active.queryText);
      setResult(active.lastResult ?? null);
      setResultMeta(active.lastResultMeta ?? null);

      setPrefixes((await prefixStore.list()).sort((a, b) => a.prefix.localeCompare(b.prefix)));
      setEndpoints((await endpointStore.list()).sort((a, b) => a.createdAt - b.createdAt));
    })();
  }, [settingsLoaded]);

  const activeEndpoint = endpoints.find((e) => e.id === activeEndpointId);

  // ── Query switching helpers ───────────────────────────────────────────────

  async function flushCurrentQuery() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const id = activeQueryIdRef.current;
    if (!id) return;
    const q = savedQueriesRef.current.find((x) => x.id === id);
    if (!q) return;
    const now = Date.now();
    const updated = { ...q, queryText: localStorage.getItem(CURRENT_QUERY_KEY) ?? q.queryText, updatedAt: now };
    setSavedQueries((prev) => prev.map((x) => (x.id === id ? updated : x)));
    await queryStore.upsert(updated);
  }

  async function switchQuery(id: string) {
    await flushCurrentQuery();
    const target = savedQueriesRef.current.find((q) => q.id === id);
    if (!target) return;
    setActiveQueryId(id);
    localStorage.setItem(ACTIVE_QUERY_KEY, id);
    setQueryText(target.queryText);
    localStorage.setItem(CURRENT_QUERY_KEY, target.queryText);
    setResult(target.lastResult ?? null);
    setResultMeta(target.lastResultMeta ?? null);
  }

  async function newQuery() {
    await flushCurrentQuery();
    const id = uid();
    const now = Date.now();
    const query: SavedQuery = {
      id,
      title: "Untitled",
      queryText: DEFAULT_QUERY,
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    await queryStore.upsert(query);
    setSavedQueries((prev) => [query, ...prev]);
    setActiveQueryId(id);
    localStorage.setItem(ACTIVE_QUERY_KEY, id);
    setQueryText(DEFAULT_QUERY);
    localStorage.setItem(CURRENT_QUERY_KEY, DEFAULT_QUERY);
    setResult(null);
    setResultMeta(null);
  }

  async function renameQuery(id: string, title: string) {
    setSavedQueries((prev) => {
      const updated = prev.map((q) => (q.id === id ? { ...q, title } : q));
      const q = updated.find((x) => x.id === id);
      if (q) void queryStore.upsert(q);
      return updated;
    });
  }

  async function colorQuery(id: string, color: string) {
    setSavedQueries((prev) => {
      const updated = prev.map((q) => (q.id === id ? { ...q, color } : q));
      const q = updated.find((x) => x.id === id);
      if (q) void queryStore.upsert(q);
      return updated;
    });
  }

  async function deleteQuery(id: string) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    await queryStore.remove(id);
    const isActive = id === activeQueryIdRef.current;
    const remaining = savedQueriesRef.current.filter((q) => q.id !== id);
    setSavedQueries(remaining);

    if (isActive) {
      if (remaining.length > 0) {
        const next = remaining[0];
        setActiveQueryId(next.id);
        localStorage.setItem(ACTIVE_QUERY_KEY, next.id);
        setQueryText(next.queryText);
        localStorage.setItem(CURRENT_QUERY_KEY, next.queryText);
        setResult(next.lastResult ?? null);
        setResultMeta(next.lastResultMeta ?? null);
      } else {
        // No queries left — create a fresh default
        const now = Date.now();
        const fresh: SavedQuery = { id: uid(), title: "Untitled", queryText: DEFAULT_QUERY, tags: [], createdAt: now, updatedAt: now };
        await queryStore.upsert(fresh);
        setSavedQueries([fresh]);
        setActiveQueryId(fresh.id);
        localStorage.setItem(ACTIVE_QUERY_KEY, fresh.id);
        setQueryText(DEFAULT_QUERY);
        localStorage.setItem(CURRENT_QUERY_KEY, DEFAULT_QUERY);
        setResult(null);
        setResultMeta(null);
      }
    }
  }

  // ── Endpoints ─────────────────────────────────────────────────────────────

  async function selectEndpoint(id: string) {
    setActiveEndpointId(id);
    const next = { ...settings, activeEndpointId: id };
    setSettings(next);
    await settingsStore.set(next);
  }

  async function addEndpoint(label: string, url: string) {
    const entry: EndpointEntry = { id: uid(), label, url, createdAt: Date.now() };
    await endpointStore.upsert(entry);
    setEndpoints((prev) => [...prev, entry]);
    await selectEndpoint(entry.id);
  }

  async function removeEndpoint(id: string) {
    await endpointStore.remove(id);
    setEndpoints((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (id === activeEndpointId && next.length > 0) {
        void selectEndpoint(next[0].id);
      }
      return next;
    });
  }

  // ── Query execution ───────────────────────────────────────────────────────

  const runQuery = useCallback(async () => {
    if (!activeEndpoint) return;
    const startedAt = Date.now();
    const endpointUrl = normalizeEndpointUrl(activeEndpoint.url);

    if (isLocalhostUrl(endpointUrl) && !bridge.isAvailable()) {
      setLocalhostModalOpen(true);
      return;
    }

    setIsRunning(true);
    setStatusMessage("Running query...");

    const queryWithPrefixes = globalPrefixesOn ? applyPrefixes(queryText, prefixes) : queryText;
    const response = isLocalhostUrl(endpointUrl)
      ? await bridge.executeQuery({ endpointUrl, timeoutMs: settings.timeoutMs, query: queryWithPrefixes })
      : await directFetch(endpointUrl, queryWithPrefixes, settings.timeoutMs);

    const durationMs = Date.now() - startedAt;
    const id = activeQueryIdRef.current;

    if (response.ok) {
      const rowCount = response.data.results.bindings.length;
      const meta: ResultMeta = { ok: true, durationMs, rowCount };
      setResult(response.data);
      setResultMeta(meta);
      setStatusMessage(`Success: ${rowCount} rows.`);

      // Persist result to active query (skip lastResult for large datasets to avoid bloating IDB)
      if (id) {
        const resultToStore = rowCount <= IDB_RESULT_ROW_CAP ? response.data : undefined;
        setSavedQueries((prev) => {
          const updated = prev.map((q) =>
            q.id === id ? { ...q, lastResult: resultToStore, lastResultMeta: meta, updatedAt: Date.now() } : q
          );
          const q = updated.find((x) => x.id === id);
          if (q) void queryStore.upsert(q);
          return updated;
        });
      }

      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText,
        endpoint: endpointUrl,
        startedAt,
        durationMs,
        status: "success",
        rowCount,
        preview: queryText.slice(0, 120)
      };
      await addEntry(entry);
    } else {
      const meta: ResultMeta = { ok: false, durationMs, rowCount: 0, errorCode: response.error.code, errorMessage: response.error.message };
      setResultMeta(meta);
      setStatusMessage(response.error.message);

      // Persist error meta to active query
      if (id) {
        setSavedQueries((prev) => {
          const updated = prev.map((q) =>
            q.id === id ? { ...q, lastResult: undefined, lastResultMeta: meta, updatedAt: Date.now() } : q
          );
          const q = updated.find((x) => x.id === id);
          if (q) void queryStore.upsert(q);
          return updated;
        });
      }

      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText,
        endpoint: endpointUrl,
        startedAt,
        durationMs,
        status: "error",
        rowCount: 0,
        error: response.error.message
      };
      await addEntry(entry);
    }
    setIsRunning(false);
  }, [activeEndpoint, bridge, settings.timeoutMs, queryText, prefixes, globalPrefixesOn, addEntry]);

  // ── Prefixes ──────────────────────────────────────────────────────────────

  async function savePrefix(prefix: string, iri: string) {
    const item: PrefixEntry = { prefix, iri, source: "local", updatedAt: Date.now(), enabled: true };
    await prefixStore.upsert(item);
    setPrefixes((prev) =>
      [...prev.filter((e) => e.prefix !== prefix), item].sort((a, b) => a.prefix.localeCompare(b.prefix))
    );
  }

  async function addPrefix() {
    const prefix = prompt("Prefix (e.g. foaf)")?.trim();
    const iri = prompt("IRI (e.g. http://xmlns.com/foaf/0.1/)")?.trim();
    if (!prefix || !iri) return;
    await savePrefix(prefix, iri);
  }

  async function togglePrefix(prefix: string) {
    setPrefixes((prev) => {
      const updated = prev.map((p) =>
        p.prefix === prefix ? { ...p, enabled: p.enabled === false ? true : false } : p
      );
      const item = updated.find((p) => p.prefix === prefix)!;
      void prefixStore.upsert(item);
      return updated;
    });
  }

  async function removePrefix(prefix: string) {
    await prefixStore.remove(prefix);
    setPrefixes((prev) => prev.filter((p) => p.prefix !== prefix));
  }

  async function verifyBridge(extensionId: string): Promise<boolean> {
    if (!activeEndpoint || !extensionId) return false;
    const testBridge = new BridgeClient(extensionId);
    const response = await testBridge.healthCheck({
      endpointUrl: normalizeEndpointUrl(activeEndpoint.url),
      timeoutMs: settings.timeoutMs
    });
    if (response.ok) {
      const next = { ...settings, extensionId };
      setSettings(next);
      await settingsStore.set(next);
    }
    return response.ok;
  }

  const activePrefixCount = prefixes.filter((p) => p.enabled !== false).length;

  function toggleGlobalPrefixes() {
    const next = !globalPrefixesOn;
    setGlobalPrefixesOn(next);
    localStorage.setItem("sparql-studio:prefixesOn", String(next));
  }

  const editorSection = (
    <div className="h-full flex flex-col overflow-hidden bg-white rounded-tr-lg">
      <div className="shrink-0 flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-gray-200 bg-gray-50">
        <button className="btn" disabled={isRunning} onClick={() => void runQuery()}>
          <i className={isRunning ? "ri-loader-4-line" : "ri-play-line"} /> {isRunning ? "Running..." : "Run query"}
        </button>
        {prefixes.length > 0 && (
          <button
            className={`text-xs rounded px-1.5 py-0.5 shrink-0 self-center border transition-colors ${
              globalPrefixesOn
                ? "text-green-700 bg-green-100 border-green-300 hover:bg-green-200"
                : "text-gray-500 bg-gray-100 border-gray-300 hover:bg-gray-200"
            }`}
            onClick={toggleGlobalPrefixes}
            title={globalPrefixesOn ? "Click to disable all prefixes" : "Click to enable prefixes"}
          >
            <i className="ri-braces-line" />{" "}
            {globalPrefixesOn
              ? `${activePrefixCount} prefix${activePrefixCount !== 1 ? "es" : ""} active`
              : "Prefixes off"}
          </button>
        )}
      </div>
      <SparqlEditorSurface key={activeQueryId} value={queryText} onChange={setQueryText} onAddPrefix={(p, iri) => void savePrefix(p, iri)} />
    </div>
  );

  const resultsSection = (
    <ResultsPanel
      result={result}
      meta={resultMeta}
      onNavigateToSubject={(uri) => navigate("/subject?uri=" + encodeURIComponent(uri), { state: { breadcrumbs: [] } })}
    />
  );

  return (
    <main className="h-screen overflow-hidden flex flex-col bg-zinc-900 px-2">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm shrink-0">
        <button
          className="btn-dark shrink-0 text-base leading-none px-2"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          <i className="ri-layout-left-line" />
        </button>
        <span className="font-semibold text-white shrink-0">SPARQL Studio</span>
        <button
          className="btn-dark text-xs shrink-0"
          onClick={() => navigate("/graphs")}
          title="Graph Explorer"
        >
          <i className="ri-node-tree" /> Graphs
        </button>
        <EndpointPicker
          endpoints={endpoints}
          activeId={activeEndpointId}
          onSelect={(id) => void selectEndpoint(id)}
          onAdd={addEndpoint}
          onRemove={(id) => void removeEndpoint(id)}
        />
        {activeEndpoint && isLocalhostUrl(activeEndpoint.url) && (
          <button
            className="btn-dark text-xs shrink-0"
            onClick={() => setLocalhostModalOpen(true)}
          >
            {bridge.isAvailable() ? "Bridge active" : "Enable localhost querying"}
          </button>
        )}
        <div className="ml-auto flex gap-1 shrink-0">
          <button className="btn-dark" onClick={() => setSettingsOpen(true)}><i className="ri-settings-3-line" /> Settings</button>
        </div>
      </div>

      {/* Main content: history sidebar | editor+results */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0 rounded-tl-lg">
        {sidebarOpen && (
          <>
            <Panel defaultSize={25} minSize={15}>
              <LeftPanel
                history={history}
                savedQueries={savedQueries}
                activeQueryId={activeQueryId}
                prefixes={prefixes}
                onNewQuery={() => void newQuery()}
                onActivateQuery={(id) => void switchQuery(id)}
                onRenameQuery={(id, title) => void renameQuery(id, title)}
                onColorQuery={(id, color) => void colorQuery(id, color)}
                onDeleteQuery={(id) => void deleteQuery(id)}
                onAddPrefix={() => void addPrefix()}
                onTogglePrefix={(prefix: string) => void togglePrefix(prefix)}
                onRemovePrefix={(prefix: string) => void removePrefix(prefix)}
                onHide={() => setSidebarOpen(false)}
              />
            </Panel>
            <Separator className="splitHandleH" />
          </>
        )}
        <Panel defaultSize={75} minSize={40}>
          <SplitLayout top={editorSection} bottom={resultsSection} initialTopSize={60} minTopSize={25} minBottomSize={15} />
        </Panel>
      </PanelGroup>

      {/* Status bar */}
      <div className="shrink-0 bg-[#007acc] text-white text-[0.72rem] px-3 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis" role="status">
        {statusMessage}{heap ? ` | Heap: ${heap.usedMB} MB / ${heap.limitMB} MB` : ""}
      </div>

      {/* Localhost bridge modal */}
      {localhostModalOpen && activeEndpoint && (
        <LocalhostBridgeModal
          endpointUrl={activeEndpoint.url}
          savedExtensionId={settings.extensionId}
          onClose={() => setLocalhostModalOpen(false)}
          onVerify={verifyBridge}
        />
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <Modal label="Settings" onClose={() => setSettingsOpen(false)}>
          <h2 className="mt-0">Settings</h2>
          <label className="field-label">
            Query timeout (ms)
            <input
              className="field-input"
              type="number"
              autoFocus
              value={settingsDraft.timeoutMs}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <div className="flex gap-2 mt-3">
            <button
              className="btn"
              onClick={async () => {
                const next = { ...settings, timeoutMs: settingsDraft.timeoutMs };
                setSettings(next);
                await settingsStore.set(next);
                setSettingsOpen(false);
              }}
            >
              Save
            </button>
            <button className="btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

export default App;
