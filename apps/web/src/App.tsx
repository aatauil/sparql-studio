import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BridgeClient } from "./bridge";
import {
  prefixStore,
  queryStore,
  settingsStore,
  type AppSettings,
  type PrefixEntry,
  type QueryHistoryEntry,
  type SavedQuery
} from "./storage";
import { createSparqlEditor } from "sparql-editor";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { toCsv } from "./query-utils";
import { SplitLayout } from "./SplitLayout";
import { useSettings, defaultSettings } from "./hooks/useSettings";
import { useHistoryManager } from "./hooks/useHistoryManager";
import { ResultsTable } from "./components/ResultsTable";
import { HistorySidebar } from "./components/HistorySidebar";
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
  type ConnectionState = "connected" | "disconnected" | "checking";
  const navigate = useNavigate();
  const { settings: loadedSettings, isLoaded: settingsLoaded } = useSettings();
  const { history, addEntry } = useHistoryManager();
  const [settings, setSettings] = useState(defaultSettings);
  const [queryText, setQueryText] = useState(
    () => localStorage.getItem(CURRENT_QUERY_KEY) ?? DEFAULT_QUERY
  );
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [prefixes, setPrefixes] = useState<PrefixEntry[]>([]);
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready.");
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionMessage, setConnectionMessage] = useState("Connection not checked yet.");
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [savedQueriesOpen, setSavedQueriesOpen] = useState(false);
  const [prefixesOpen, setPrefixesOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bridge = useMemo(() => new BridgeClient({ extensionId: settings.extensionId }), [settings.extensionId]);

  // Persist current query to localStorage on every change
  useEffect(() => {
    localStorage.setItem(CURRENT_QUERY_KEY, queryText);
  }, [queryText]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConnectionModalOpen(false);
        setSavedQueriesOpen(false);
        setPrefixesOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  const runHealthCheck = useCallback(async (sourceSettings: AppSettings) => {
    setConnectionState("checking");
    bridge.setExtensionId(sourceSettings.extensionId);
    const response = await bridge.healthCheck({
      endpointUrl: sourceSettings.endpointUrl,
      timeoutMs: sourceSettings.timeoutMs
    });
    if (response.ok) {
      setConnectionState("connected");
      setConnectionMessage("Connected");
      setStatusMessage("Extension bridge is connected.");
      return;
    }
    setConnectionState("disconnected");
    setConnectionMessage(response.error.message);
    setStatusMessage(response.error.message);
  }, [bridge]);

  useEffect(() => {
    if (!settingsLoaded) return;
    setSettings(loadedSettings);
    setSettingsDraft(loadedSettings);
  }, [settingsLoaded, loadedSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    (async () => {
      const list = await prefixStore.list();
      if (list.length === 0) {
        for (const prefix of defaultPrefixes) {
          await prefixStore.upsert(prefix);
        }
      }
      setSavedQueries((await queryStore.list()).sort((a, b) => b.updatedAt - a.updatedAt));
      setPrefixes((await prefixStore.list()).sort((a, b) => a.prefix.localeCompare(b.prefix)));
      await runHealthCheck(loadedSettings);
    })();
  }, [settingsLoaded, loadedSettings, runHealthCheck]);

  async function runQuery() {
    const startedAt = Date.now();
    setIsRunning(true);
    setStatusMessage("Running query...");
    bridge.setExtensionId(settings.extensionId);
    const response = await bridge.executeQuery({
      endpointUrl: settings.endpointUrl,
      timeoutMs: settings.timeoutMs,
      query: queryText
    });

    if (response.ok) {
      const rowCount = response.data.results.bindings.length;
      setResult(response.data);
      setStatusMessage(`Success: ${rowCount} rows.`);
      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText,
        endpoint: settings.endpointUrl,
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
        endpoint: settings.endpointUrl,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: "error",
        rowCount: 0,
        error: response.error.message
      };
      await addEntry(entry);
    }
    setIsRunning(false);
  }

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

  async function updateSettings(next: AppSettings) {
    setSettings(next);
    await settingsStore.set(next);
  }

  const dotColor =
    connectionState === "connected" ? "bg-green-600" :
    connectionState === "checking"  ? "bg-amber-400" :
                                      "bg-red-600";

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
      <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1e1e1e] text-sm border-b border-[#333] shrink-0">
        <span className="font-semibold text-white">SPARQL Studio</span>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
        <span className="text-[#9ca3af] text-xs overflow-hidden text-ellipsis whitespace-nowrap max-w-[300px]">
          {settings.endpointUrl || defaultSettings.endpointUrl}
        </span>
        <div className="ml-auto flex gap-1">
          <button className="btn-dark" onClick={() => setSavedQueriesOpen(true)}>Saved queries</button>
          <button className="btn-dark" onClick={() => setSidebarOpen((v) => !v)}>
            History
          </button>
          <button className="btn-dark" onClick={() => setPrefixesOpen(true)}>Prefixes</button>
          <button className="btn-dark" onClick={() => setConnectionModalOpen(true)}>
            {connectionState === "connected" ? "Connection" : "Connect"}
          </button>
        </div>
      </div>

      {/* Main content: history sidebar | editor+results */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {sidebarOpen && (
          <>
            <Panel defaultSize={25} minSize={15}>
              <HistorySidebar history={history} />
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

      {/* Connection modal */}
      {connectionModalOpen && (
        <Modal label="Connection settings" onClose={() => setConnectionModalOpen(false)}>
          <h2 className="mt-0">Connection settings</h2>
          <label className="field-label">
            Local endpoint
            <input
              className="field-input"
              autoFocus
              value={settingsDraft.endpointUrl}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, endpointUrl: e.target.value })}
            />
          </label>
          <label className="field-label">
            Bridge extension ID
            <input
              className="field-input"
              value={settingsDraft.extensionId}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, extensionId: e.target.value })}
            />
          </label>
          <label className="field-label">
            Timeout (ms)
            <input
              className="field-input"
              type="number"
              value={settingsDraft.timeoutMs}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <p className="text-gray-500 text-sm">{connectionMessage}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              className="btn"
              onClick={async () => {
                await updateSettings(settingsDraft);
                await runHealthCheck(settingsDraft);
                setConnectionModalOpen(false);
              }}
            >
              Save and test connection
            </button>
            <button className="btn" onClick={() => setConnectionModalOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Saved queries modal */}
      {savedQueriesOpen && (
        <Modal label="Saved queries" onClose={() => setSavedQueriesOpen(false)}>
          <h2 className="mt-0">Saved queries</h2>
          <ul className="list-none p-0 m-0 grid gap-1.5">
            {savedQueries.map((item) => (
              <li key={item.id}>
                <button
                  className="btn-list"
                  onClick={() => { setQueryText(item.queryText); setSavedQueriesOpen(false); }}
                >
                  {item.title}
                </button>
              </li>
            ))}
            {savedQueries.length === 0 && <li className="text-gray-500 text-sm">No saved queries yet.</li>}
          </ul>
          <div className="flex gap-2 mt-3">
            <button className="btn" onClick={() => setSavedQueriesOpen(false)}>Close</button>
          </div>
        </Modal>
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
    </main>
  );
}

export default App;
