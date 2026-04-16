import { useState } from "react";
import type { PrefixEntry, QueryHistoryEntry, SavedQuery } from "../../storage";
import { HistoryPanel } from "./HistoryPanel";
import { QueriesPanel } from "./QueriesPanel";
import { PrefixPanel } from "./PrefixPanel";

type SidebarView = "saved" | "history" | "prefixes";

interface LeftPanelProps {
  history: QueryHistoryEntry[];
  historyError: string | null;
  savedQueries: SavedQuery[];
  activeQueryId: string;
  prefixes: PrefixEntry[];
  prefixesError: string | null;
  onNewQuery: () => void;
  onActivateQuery: (id: string) => void;
  onRenameQuery: (id: string, title: string) => void;
  onColorQuery: (id: string, color: string) => void;
  onDeleteQuery: (id: string) => void;
  onDuplicateQuery: (id: string) => void;
  onAddPrefix: () => void;
  onTogglePrefix: (prefix: string) => void;
  onRemovePrefix: (prefix: string) => void;
  onHide: () => void;
}

export function LeftPanel({
  history,
  historyError,
  savedQueries,
  activeQueryId,
  prefixes,
  prefixesError,
  onNewQuery,
  onActivateQuery,
  onRenameQuery,
  onColorQuery,
  onDeleteQuery,
  onDuplicateQuery,
  onAddPrefix,
  onTogglePrefix,
  onRemovePrefix,
  onHide
}: LeftPanelProps) {
  const [view, setView] = useState<SidebarView>("saved");

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white border-r border-gray-200">
      {/* Tab nav */}
      <div className="shrink-0 flex items-center border-b border-gray-200 bg-gray-50">
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            view === "saved"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("saved")}
        >
          <i className="ri-file-list-3-line" /> Queries
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            view === "history"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("history")}
        >
          <i className="ri-history-line" /> History
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            view === "prefixes"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("prefixes")}
        >
          <i className="ri-braces-line" /> Prefixes
        </button>
        <button
          className="ml-auto px-2 py-1.5 text-gray-400 hover:text-gray-600 text-base leading-none"
          onClick={onHide}
          title="Hide panel"
        >
          <i className="ri-panel-left-close-line" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {view === "saved" && (
          <QueriesPanel
            queries={savedQueries}
            activeQueryId={activeQueryId}
            onNewQuery={onNewQuery}
            onActivate={onActivateQuery}
            onRename={onRenameQuery}
            onColor={onColorQuery}
            onDelete={onDeleteQuery}
          onDuplicate={onDuplicateQuery}
          />
        )}
        {view === "history" && (
          <HistoryPanel history={history} error={historyError} />
        )}
        {view === "prefixes" && (
          <PrefixPanel
            prefixes={prefixes}
            error={prefixesError}
            onAdd={onAddPrefix}
            onToggle={onTogglePrefix}
            onRemove={onRemovePrefix}
          />
        )}
      </div>
    </div>
  );
}
