import { memo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QueryHistoryEntry, SavedQuery } from "../storage";

type SidebarView = "history" | "saved";

interface LeftPanelProps {
  history: QueryHistoryEntry[];
  savedQueries: SavedQuery[];
  onLoadQuery: (queryText: string) => void;
  onRemoveSaved: (id: string) => void;
  onHide: () => void;
}

// ── History ──────────────────────────────────────────────────────────────────

function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function groupByDate(entries: QueryHistoryEntry[]): { bucket: string; items: QueryHistoryEntry[] }[] {
  const map = new Map<string, QueryHistoryEntry[]>();
  for (const entry of entries) {
    const bucket = dateBucket(entry.startedAt);
    if (!map.has(bucket)) map.set(bucket, []);
    map.get(bucket)!.push(entry);
  }
  return Array.from(map.entries()).map(([bucket, items]) => ({ bucket, items }));
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      className="btn-ghost-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={handleCopy}
      title="Copy query to clipboard"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function HistoryItem({ item }: { item: QueryHistoryEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  function handleMouseEnter() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setTooltipPos({ x: rect.right + 8, y: rect.top });
    }
  }

  return (
    <div
      ref={ref}
      className="group px-3 py-1.5 border border-gray-200 bg-zinc-100 hover:bg-gray-50 mb-1"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTooltipPos(null)}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            item.status === "success" ? "bg-green-500" : "bg-red-500"
          }`}
          aria-hidden="true"
        />
        <span className="text-[0.68rem] text-gray-500">
          {new Date(item.startedAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit"
          })}
        </span>
        <span className="text-[0.68rem] text-gray-400 ml-auto">
          {item.status === "success" ? `${item.rowCount} rows` : "error"}
        </span>
      </div>
      <div className="flex items-start gap-1.5 bg-zinc-200 p-1">
        <code className="flex-1 text-[0.6rem] text-gray-600 leading-snug line-clamp-2 break-all font-mono">
          {(item.preview ?? item.queryText).slice(0, 120)}
        </code>
        <CopyButton text={item.queryText} />
      </div>
      {item.error && (
        <p className="mt-0.5 text-[0.65rem] text-red-500 truncate">{item.error}</p>
      )}
      {tooltipPos &&
        createPortal(
          <div
            className="fixed z-50 overflow-auto rounded border border-gray-200 bg-white p-4 shadow-lg pointer-events-none"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            <pre className="whitespace-pre-wrap text-[0.65rem] text-gray-700 font-mono leading-snug">
              {item.queryText}
            </pre>
          </div>,
          document.body
        )}
    </div>
  );
}

const HistoryList = memo(function HistoryList({ history }: { history: QueryHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="px-3 py-4 text-xs text-gray-400">No history yet.</p>;
  }

  const groups = groupByDate(history);

  return (
    <div>
      {groups.map(({ bucket, items }) => (
        <div key={bucket}>
          <p className="px-3 pt-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-gray-400">
            {bucket}
          </p>
          {items.map((item) => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
});

// ── Saved queries ─────────────────────────────────────────────────────────────

function SavedQueryItem({
  item,
  onLoad,
  onRemove
}: {
  item: SavedQuery;
  onLoad: (queryText: string) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  function handleMouseEnter() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setTooltipPos({ x: rect.right + 8, y: rect.top });
    }
  }

  return (
    <div
      ref={ref}
      className="group px-3 py-1.5 border border-gray-200 bg-zinc-100 hover:bg-gray-50 mb-1 cursor-pointer"
      onClick={() => onLoad(item.queryText)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTooltipPos(null)}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="flex-1 text-[0.72rem] font-medium text-gray-700 truncate">{item.title}</span>
        <button
          className="btn-ghost-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
          onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
          title="Remove saved query"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      <div className="bg-zinc-200 p-1">
        <code className="block text-[0.6rem] text-gray-600 leading-snug line-clamp-2 break-all font-mono">
          {item.queryText.slice(0, 100)}
        </code>
      </div>
      {tooltipPos &&
        createPortal(
          <div
            className="fixed z-50 overflow-auto rounded border border-gray-200 bg-white p-4 shadow-lg pointer-events-none"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            <p className="text-[0.65rem] font-semibold text-gray-800 mb-1">{item.title}</p>
            <pre className="whitespace-pre-wrap text-[0.65rem] text-gray-700 font-mono leading-snug">
              {item.queryText}
            </pre>
          </div>,
          document.body
        )}
    </div>
  );
}

const SavedQueriesList = memo(function SavedQueriesList({
  queries,
  onLoad,
  onRemove
}: {
  queries: SavedQuery[];
  onLoad: (queryText: string) => void;
  onRemove: (id: string) => void;
}) {
  if (queries.length === 0) {
    return <p className="px-3 py-4 text-xs text-gray-400">No saved queries yet.</p>;
  }

  return (
    <div className="pt-2">
      {queries.map((item) => (
        <SavedQueryItem key={item.id} item={item} onLoad={onLoad} onRemove={onRemove} />
      ))}
    </div>
  );
});

// ── Left panel ────────────────────────────────────────────────────────────────

export function LeftPanel({ history, savedQueries, onLoadQuery, onRemoveSaved, onHide }: LeftPanelProps) {
  const [view, setView] = useState<SidebarView>("history");

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white border-r border-gray-200">
      {/* Tab nav */}
      <div className="shrink-0 flex items-center border-b border-gray-200 bg-gray-50">
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
            view === "saved"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("saved")}
        >
          <i className="ri-star-line" /> Saved
        </button>
        <button
          className="ml-auto px-2 py-1.5 text-gray-400 hover:text-gray-600 text-base leading-none"
          onClick={onHide}
          title="Hide panel"
        >
          <i className="ri-panel-left-close-line" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {view === "history" ? (
          <HistoryList history={history} />
        ) : (
          <SavedQueriesList queries={savedQueries} onLoad={onLoadQuery} onRemove={onRemoveSaved} />
        )}
      </div>
    </div>
  );
}
