import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BridgeClient } from "./bridge";
import {
  settingsStore,
  type QueryHistoryEntry,
  type ResultMeta
} from "./storage";
import { createSparqlEditor } from "sparql-editor";
import { prefixCompletion } from "./extensions/prefixCompletion";
import type { HttpResponseInfo, SparqlJsonResult } from "@sparql-studio/contracts";
import { directFetch, isLocalhostUrl, normalizeEndpointUrl } from "./sparql-fetch";
import { SplitLayout } from "./SplitLayout";
import { useSettings, defaultSettings } from "./hooks/useSettings";
import { useHistoryManager } from "./hooks/useHistoryManager";
import { useHeapMemory } from "./hooks/useHeapMemory";
import { useEscapeKey } from "./hooks/useEscapeKey"; // used for localhostModal
import { useQueryManager } from "./hooks/useQueryManager";
import { usePrefixManager, useDisplayPrefixes, DisplayPrefixContext } from "./hooks/usePrefixManager";
import { useEndpointManager } from "./hooks/useEndpointManager";
import { ResultsPanel } from "./components/ResultsPanel";
import { LeftPanel } from "./components/sidebar/Sidebar";
import { EndpointPicker } from "./components/EndpointPicker";
import { LocalhostBridgeModal } from "./components/LocalhostBridgeModal";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";
import { uid } from "./config";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";

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


function App() {
  const navigate = useNavigate();
  const { settings: loadedSettings, isLoaded: settingsLoaded, error: settingsError } = useSettings();
  const { history, error: historyError, addEntry } = useHistoryManager();
  const heap = useHeapMemory();

  const [settings, setSettings] = useState(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [localhostModalOpen, setLocalhostModalOpen] = useState(false);
  const [result, setResult] = useState<SparqlJsonResult | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [rawHttpResponse, setRawHttpResponse] = useState<HttpResponseInfo | null>(null);
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
  const displayPrefixes = useDisplayPrefixes(pm.prefixes, pm.globalPrefixesOn);
  const em = useEndpointManager(
    settingsLoaded,
    loadedSettings.activeEndpointId,
    settings,
    setSettings
  );

  const bridge = useMemo(() => new BridgeClient(settings.extensionId), [settings.extensionId]);

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
    setRawHttpResponse(null);

    const queryWithPrefixes = pm.applyPrefixesIfEnabled(qm.queryText);
    const response = isLocalhostUrl(endpointUrl)
      ? await bridge.executeQuery({ endpointUrl, timeoutMs: settings.timeoutMs, query: queryWithPrefixes })
      : await directFetch(endpointUrl, queryWithPrefixes, settings.timeoutMs);

    const durationMs = Date.now() - startedAt;
    setRawHttpResponse(response.httpResponse ?? null);

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
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div className="shrink-0 flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-gray-200 bg-gray-50">
        <Button className="bg-green-600 text-white hover:bg-green-700" disabled={isRunning} onClick={() => void runQuery()}>
          <i className={isRunning ? "ri-loader-4-line" : "ri-play-line"} /> {isRunning ? "Running..." : "Run query"}
        </Button>
        {pm.prefixes.length > 0 && (
          <Button
            variant="outline"
            size="xs"
            className={`self-center ${
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
          </Button>
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
      rawHttpResponse={rawHttpResponse}
      onNavigateToSubject={(uri) => navigate("/subject?uri=" + encodeURIComponent(uri), { state: { breadcrumbs: [] } })}
    />
  );

  if (settingsError) {
    return (
      <main className="h-screen flex items-center justify-center bg-zinc-900 text-center p-4">
        <div>
          <p className="text-white font-semibold mb-2">Storage unavailable</p>
          <p className="text-gray-400 text-sm">{settingsError}</p>
        </div>
      </main>
    );
  }

  return (
    <DisplayPrefixContext.Provider value={displayPrefixes}>
    <main className="h-screen overflow-hidden flex flex-col bg-zinc-900">
      {/* Top toolbar */}
      <div className="dark flex items-center gap-2 px-3 py-1.5 text-sm shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 text-base leading-none px-2"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          <i className="ri-layout-left-line" />
        </Button>
        <span className="font-semibold text-white shrink-0">SPARQL Studio</span>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => navigate("/graphs")}
          title="Graph Explorer"
        >
          <i className="ri-node-tree" /> Graphs
        </Button>
        <EndpointPicker
          endpoints={em.endpoints}
          activeId={em.activeEndpointId}
          error={em.error}
          onSelect={(id) => void em.selectEndpoint(id)}
          onAdd={em.addEndpoint}
          onRemove={(id) => void em.removeEndpoint(id)}
        />
        {em.activeEndpoint && isLocalhostUrl(em.activeEndpoint.url) && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setLocalhostModalOpen(true)}
          >
            {bridge.isAvailable() ? "Bridge active" : "Enable localhost querying"}
          </Button>
        )}
        <div className="ml-auto flex gap-1 shrink-0">
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}><i className="ri-settings-3-line" /> Settings</Button>
        </div>
      </div>

      {/* Main content: history sidebar | editor+results */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {sidebarOpen && (
          <>
            <Panel defaultSize={20} minSize={5}>
              <LeftPanel
                history={history}
                historyError={historyError}
                savedQueries={qm.savedQueries}
                activeQueryId={qm.activeQueryId}
                prefixes={pm.prefixes}
                prefixesError={pm.error}
                onNewQuery={() => void qm.newQuery()}
                onActivateQuery={(id) => void qm.switchQuery(id)}
                onRenameQuery={(id, title) => void qm.renameQuery(id, title)}
                onColorQuery={(id, color) => void qm.colorQuery(id, color)}
                onDeleteQuery={(id) => void qm.deleteQuery(id)}
                onDuplicateQuery={(id) => void qm.duplicateQuery(id)}
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
      {em.activeEndpoint && (
        <LocalhostBridgeModal
          open={localhostModalOpen}
          onOpenChange={setLocalhostModalOpen}
          endpointUrl={em.activeEndpoint.url}
          savedExtensionId={settings.extensionId}
          onVerify={verifyBridge}
        />
      )}

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={async () => {
                const next = { ...settings, timeoutMs: settingsDraft.timeoutMs };
                setSettings(next);
                await settingsStore.set(next);
                setSettingsOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
    </DisplayPrefixContext.Provider>
  );
}

export default App;
