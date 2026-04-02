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
  type SavedQuery
} from "./storage";
import { createSparqlEditor } from "sparql-editor";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { toCsv } from "./query-utils";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "./sparql-fetch";
import { SplitLayout } from "./SplitLayout";
import { useSettings, defaultSettings } from "./hooks/useSettings";
import { useHistoryManager } from "./hooks/useHistoryManager";
import { ResultsTable } from "./components/ResultsTable";
import { LeftPanel } from "./components/HistorySidebar";
import { EndpointPicker } from "./components/EndpointPicker";
import { LocalhostBridgeModal } from "./components/LocalhostBridgeModal";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";

const CURRENT_QUERY_KEY = "sparql-studio:currentQuery";
const DEFAULT_QUERY = "SELECT * WHERE { ?s ?p ?o } LIMIT 25";

const defaultPrefixes: PrefixEntry[] = [
  { prefix: "rdf", iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", source: "local", updatedAt: Date.now() },
  { prefix: "rdfs", iri: "http://www.w3.org/2000/01/rdf-schema#", source: "local", updatedAt: Date.now() }
];

function uid() {
  return crypto.randomUUID();
}

function applyPrefixes(queryText: string, prefixes: PrefixEntry[]): string {
  const prefixText = prefixes.map((item) => `PREFIX ${item.prefix}: <${item.iri}>`).join("\n");
  return `${prefixText}\n${queryText}`.trim();
}

function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function SparqlEditorSurface({
  value,
  onChange
}: {
  value: string;
  onChange: (next: string) => void;
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
      }
    });
    editorRef.current = editor;
  }, [onChange, value]);

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
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [prefixes, setPrefixes] = useState<PrefixEntry[]>([]);
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready.");
  const [prefixesOpen, setPrefixesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [localhostModalOpen, setLocalhostModalOpen] = useState(false);
  const bridge = useMemo(() => new BridgeClient(settings.extensionId), [settings.extensionId]);

  // Persist current query to localStorage on every change
  useEffect(() => {
    localStorage.setItem(CURRENT_QUERY_KEY, queryText);
  }, [queryText]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPrefixesOpen(false);
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
      setSavedQueries((await queryStore.list()).sort((a, b) => b.updatedAt - a.updatedAt));
      setPrefixes((await prefixStore.list()).sort((a, b) => a.prefix.localeCompare(b.prefix)));
      setEndpoints((await endpointStore.list()).sort((a, b) => a.createdAt - b.createdAt));
    })();
  }, [settingsLoaded]);

  const activeEndpoint = endpoints.find((e) => e.id === activeEndpointId);

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

    const response = isLocalhostUrl(endpointUrl)
      ? await bridge.executeQuery({ endpointUrl, timeoutMs: settings.timeoutMs, query: queryText })
      : await directFetch(endpointUrl, queryText, settings.timeoutMs);

    if (response.ok) {
      const rowCount = response.data.results.bindings.length;
      setResult(response.data);
      setStatusMessage(`Success: ${rowCount} rows.`);
      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText,
        endpoint: endpointUrl,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: "success",
        rowCount,
        preview: queryText.slice(0, 120)
      };
      await addEntry(entry);
    } else {
      setStatusMessage(response.error.message);
      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText,
        endpoint: endpointUrl,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: "error",
        rowCount: 0,
        error: response.error.message
      };
      await addEntry(entry);
    }
    setIsRunning(false);
  }, [activeEndpoint, bridge, settings.timeoutMs, queryText, addEntry]);

  async function saveCurrentQuery() {
    const title = prompt("Name this query")?.trim();
    if (!title) return;
    const now = Date.now();
    const query: SavedQuery = {
      id: uid(),
      title,
      queryText,
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    await queryStore.upsert(query);
    setSavedQueries((prev) => [query, ...prev]);
  }

  async function removeSavedQuery(id: string) {
    await queryStore.remove(id);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
  }

  async function addPrefix() {
    const prefix = prompt("Prefix (e.g. foaf)")?.trim();
    const iri = prompt("IRI (e.g. http://xmlns.com/foaf/0.1/)")?.trim();
    if (!prefix || !iri) return;
    const item: PrefixEntry = { prefix, iri, source: "local", updatedAt: Date.now() };
    await prefixStore.upsert(item);
    setPrefixes((prev) =>
      [...prev.filter((e) => e.prefix !== prefix), item].sort((a, b) => a.prefix.localeCompare(b.prefix))
    );
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

  const editorSection = (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div className="shrink-0 flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-gray-200 bg-gray-50">
        <button className="btn" onClick={() => setQueryText(applyPrefixes(queryText, prefixes))}>Apply prefixes</button>
        <button className="btn" onClick={() => void saveCurrentQuery()}>Save query</button>
        <button className="btn" disabled={isRunning} onClick={() => void runQuery()}>
          {isRunning ? "Running..." : "Run query"}
        </button>
        <button
          className="btn"
          disabled={!result}
          onClick={() => {
            if (!result) return;
            downloadText(`results-${Date.now()}.csv`, toCsv(result), "text/csv;charset=utf-8");
          }}
        >
          Export CSV
        </button>
      </div>
      <SparqlEditorSurface value={queryText} onChange={setQueryText} />
    </div>
  );

  const resultsSection = (
    <div className="h-full flex flex-col overflow-hidden border-t border-gray-200 bg-zinc-100">
      {!result && <p className="p-3 text-gray-500">No results yet.</p>}
      {result && (
        <div className="flex-1 min-h-0 overflow-auto" role="region" aria-label="SPARQL query results">
          <ResultsTable
            result={result}
            onNavigateToSubject={(uri) => navigate("/subject?uri=" + encodeURIComponent(uri))}
          />
        </div>
      )}
    </div>
  );

  return (
    <main className="h-screen overflow-hidden flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
        <button
          className="btn-dark shrink-0 text-base leading-none px-2"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          ◧
        </button>
        <span className="font-semibold text-white shrink-0">SPARQL Studio</span>
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
          <button className="btn-dark" onClick={() => setPrefixesOpen(true)}>Prefixes</button>
          <button className="btn-dark" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>

      {/* Main content: history sidebar | editor+results */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {sidebarOpen && (
          <>
            <Panel defaultSize={25} minSize={15}>
              <LeftPanel
                history={history}
                savedQueries={savedQueries}
                onLoadQuery={(text) => setQueryText(text)}
                onRemoveSaved={(id) => void removeSavedQuery(id)}
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
        {statusMessage}
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

      {/* Prefixes modal */}
      {prefixesOpen && (
        <Modal label="Global prefixes" onClose={() => setPrefixesOpen(false)}>
          <h2 className="mt-0">Global prefixes</h2>
          <div className="flex gap-2 mb-3">
            <button className="btn" onClick={() => void addPrefix()}>Add prefix</button>
          </div>
          <ul className="list-none p-0 m-0 grid gap-1.5">
            {prefixes.map((item) => (
              <li key={item.prefix} className="text-sm">
                <code>{item.prefix}:</code> &lt;{item.iri}&gt;
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-3">
            <button className="btn" onClick={() => setPrefixesOpen(false)}>Close</button>
          </div>
        </Modal>
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
