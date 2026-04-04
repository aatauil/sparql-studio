import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BridgeClient } from "./bridge";
import {
  settingsStore,
  type QueryHistoryEntry,
  type ResultMeta
} from "./storage";
import { createSparqlEditor } from "sparql-editor";
import { prefixCompletion } from "./extensions/prefixCompletion";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "./sparql-fetch";
import { SplitLayout } from "./SplitLayout";
import { useSettings, defaultSettings } from "./hooks/useSettings";
import { useHistoryManager } from "./hooks/useHistoryManager";
import { useHeapMemory } from "./hooks/useHeapMemory";
import { useEscapeKey } from "./hooks/useEscapeKey";
import { useQueryManager } from "./hooks/useQueryManager";
import { usePrefixManager } from "./hooks/usePrefixManager";
import { useEndpointManager } from "./hooks/useEndpointManager";
import { ResultsPanel } from "./components/ResultsPanel";
import { LeftPanel } from "./components/HistorySidebar";
import { EndpointPicker } from "./components/EndpointPicker";
import { LocalhostBridgeModal } from "./components/LocalhostBridgeModal";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";
import { uid } from "./config";

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
  children: ReactNode;
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
  const heap = useHeapMemory();

  const [settings, setSettings] = useState(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [localhostModalOpen, setLocalhostModalOpen] = useState(false);
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready.");

  // Sync settings once loaded
  useEffect(() => {
    if (!settingsLoaded) return;
    setSettings(loadedSettings);
    setSettingsDraft(loadedSettings);
  }, [settingsLoaded, loadedSettings]);

  const qm = useQueryManager(settingsLoaded);
  const pm = usePrefixManager(settingsLoaded);
  const em = useEndpointManager(
    settingsLoaded,
    loadedSettings.activeEndpointId,
    settings,
    setSettings
  );

  const bridge = useMemo(() => new BridgeClient(settings.extensionId), [settings.extensionId]);

  useEscapeKey(settingsOpen, () => setSettingsOpen(false));
  useEscapeKey(localhostModalOpen, () => setLocalhostModalOpen(false));

  // ── Query execution ───────────────────────────────────────────────────────

  const runQuery = useCallback(async () => {
    if (!em.activeEndpoint) return;
    const startedAt = Date.now();
    const endpointUrl = normalizeEndpointUrl(em.activeEndpoint.url);

    if (isLocalhostUrl(endpointUrl) && !bridge.isAvailable()) {
      setLocalhostModalOpen(true);
      return;
    }

    setIsRunning(true);
    setStatusMessage("Running query...");

    const queryWithPrefixes = pm.applyPrefixesIfEnabled(qm.queryText);
    const response = isLocalhostUrl(endpointUrl)
      ? await bridge.executeQuery({ endpointUrl, timeoutMs: settings.timeoutMs, query: queryWithPrefixes })
      : await directFetch(endpointUrl, queryWithPrefixes, settings.timeoutMs);

    const durationMs = Date.now() - startedAt;

    if (response.ok) {
      const rowCount = response.data.results.bindings.length;
      const meta: ResultMeta = { ok: true, durationMs, rowCount };
      setResult(response.data);
      setResultMeta(meta);
      setStatusMessage(`Success: ${rowCount} rows.`);
      qm.persistResult(meta, response.data);

      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText: qm.queryText,
        endpoint: endpointUrl,
        startedAt,
        durationMs,
        status: "success",
        rowCount,
        preview: qm.queryText.slice(0, 120)
      };
      await addEntry(entry);
    } else {
      const meta: ResultMeta = { ok: false, durationMs, rowCount: 0, errorCode: response.error.code, errorMessage: response.error.message };
      setResultMeta(meta);
      setStatusMessage(response.error.message);
      qm.persistResult(meta);

      const entry: QueryHistoryEntry = {
        id: uid(),
        queryText: qm.queryText,
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
  }, [em.activeEndpoint, bridge, settings.timeoutMs, qm.queryText, qm.persistResult, pm.applyPrefixesIfEnabled, addEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bridge verification ───────────────────────────────────────────────────

  async function verifyBridge(extensionId: string): Promise<boolean> {
    if (!em.activeEndpoint || !extensionId) return false;
    const testBridge = new BridgeClient(extensionId);
    const response = await testBridge.healthCheck({
      endpointUrl: normalizeEndpointUrl(em.activeEndpoint.url),
      timeoutMs: settings.timeoutMs
    });
    if (response.ok) {
      const next = { ...settings, extensionId };
      setSettings(next);
      await settingsStore.set(next);
    }
    return response.ok;
  }

  // ── Restore last result when switching queries ────────────────────────────
  // Guard: only restore when the query ID actually changes (not when persistResult
  // updates the active query object, which would clear large in-session results).
  const restoredForQueryIdRef = useRef<string>("");
  useEffect(() => {
    if (!qm.activeQuery || qm.activeQueryId === restoredForQueryIdRef.current) return;
    restoredForQueryIdRef.current = qm.activeQueryId;
    setResult(qm.activeQuery.lastResult ?? null);
    setResultMeta(qm.activeQuery.lastResultMeta ?? null);
  }, [qm.activeQueryId, qm.activeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── JSX ───────────────────────────────────────────────────────────────────

  const editorSection = (
    <div className="h-full flex flex-col overflow-hidden bg-white rounded-tr-lg">
      <div className="shrink-0 flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-gray-200 bg-gray-50">
        <button className="btn" disabled={isRunning} onClick={() => void runQuery()}>
          <i className={isRunning ? "ri-loader-4-line" : "ri-play-line"} /> {isRunning ? "Running..." : "Run query"}
        </button>
        {pm.prefixes.length > 0 && (
          <button
            className={`text-xs rounded px-1.5 py-0.5 shrink-0 self-center border transition-colors ${
              pm.globalPrefixesOn
                ? "text-green-700 bg-green-100 border-green-300 hover:bg-green-200"
                : "text-gray-500 bg-gray-100 border-gray-300 hover:bg-gray-200"
            }`}
            onClick={pm.toggleGlobalPrefixes}
            title={pm.globalPrefixesOn ? "Click to disable all prefixes" : "Click to enable prefixes"}
          >
            <i className="ri-braces-line" />{" "}
            {pm.globalPrefixesOn
              ? `${pm.activePrefixCount} prefix${pm.activePrefixCount !== 1 ? "es" : ""} active`
              : "Prefixes off"}
          </button>
        )}
      </div>
      <SparqlEditorSurface
        key={qm.activeQueryId}
        value={qm.queryText}
        onChange={qm.setQueryText}
        onAddPrefix={(p, iri) => void pm.savePrefix(p, iri)}
      />
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
          endpoints={em.endpoints}
          activeId={em.activeEndpointId}
          onSelect={(id) => void em.selectEndpoint(id)}
          onAdd={em.addEndpoint}
          onRemove={(id) => void em.removeEndpoint(id)}
        />
        {em.activeEndpoint && isLocalhostUrl(em.activeEndpoint.url) && (
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
                savedQueries={qm.savedQueries}
                activeQueryId={qm.activeQueryId}
                prefixes={pm.prefixes}
                onNewQuery={() => void qm.newQuery()}
                onActivateQuery={(id) => void qm.switchQuery(id)}
                onRenameQuery={(id, title) => void qm.renameQuery(id, title)}
                onColorQuery={(id, color) => void qm.colorQuery(id, color)}
                onDeleteQuery={(id) => void qm.deleteQuery(id)}
                onAddPrefix={() => void pm.addPrefix()}
                onTogglePrefix={(prefix: string) => void pm.togglePrefix(prefix)}
                onRemovePrefix={(prefix: string) => void pm.removePrefix(prefix)}
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
      {localhostModalOpen && em.activeEndpoint && (
        <LocalhostBridgeModal
          endpointUrl={em.activeEndpoint.url}
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
