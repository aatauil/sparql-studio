import { memo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PrefixEntry, QueryHistoryEntry, SavedQuery } from "../storage";

type SidebarView = "saved" | "history" | "prefixes";

const QUERY_COLORS = [
  "#6b7280", // gray (default)
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f97316", // orange
];

interface LeftPanelProps {
  history: QueryHistoryEntry[];
  savedQueries: SavedQuery[];
  activeQueryId: string;
  prefixes: PrefixEntry[];
  onNewQuery: () => void;
  onActivateQuery: (id: string) => void;
  onRenameQuery: (id: string, title: string) => void;
  onColorQuery: (id: string, color: string) => void;
  onDeleteQuery: (id: string) => void;
  onAddPrefix: () => void;
  onTogglePrefix: (prefix: string) => void;
  onRemovePrefix: (prefix: string) => void;
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

// ── Query manager ─────────────────────────────────────────────────────────────

function ColorPicker({
  current,
  onPick
}: {
  current?: string;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function handlePick(color: string) {
    onPick(color);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="shrink-0 w-4 h-4 rounded-full border border-white/50 shadow-sm hover:scale-110 transition-transform"
        style={{ background: current ?? QUERY_COLORS[0] }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Change color"
      />
      {open && createPortal(
        <div
          className="fixed z-50"
          style={(() => {
            const r = ref.current?.getBoundingClientRect();
            return r ? { left: r.right + 4, top: r.top } : {};
          })()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white border border-gray-200 rounded shadow-lg p-1.5 grid grid-cols-4 gap-1">
            {QUERY_COLORS.map((c) => (
              <button
                key={c}
                className="w-5 h-5 rounded-full border-2 hover:scale-110 transition-transform"
                style={{
                  background: c,
                  borderColor: c === (current ?? QUERY_COLORS[0]) ? "white" : "transparent",
                  outline: c === (current ?? QUERY_COLORS[0]) ? `2px solid ${c}` : "none"
                }}
                onClick={() => handlePick(c)}
                title={c}
              />
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function SavedQueryItem({
  item,
  isActive,
  onActivate,
  onRename,
  onColor,
  onDelete
}: {
  item: SavedQuery;
  isActive: boolean;
  onActivate: () => void;
  onRename: (title: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const color = item.color ?? QUERY_COLORS[0];

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(item.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.title) onRename(trimmed);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setEditing(false);
    e.stopPropagation();
  }

  return (
    <div
      className={`group flex items-stretch mb-1 cursor-pointer border transition-colors ${
        isActive
          ? "border-blue-300 bg-blue-50 hover:bg-blue-100"
          : "border-gray-200 bg-zinc-100 hover:bg-gray-50"
      }`}
      onClick={onActivate}
    >
      {/* Color stripe */}
      <div className="w-1 shrink-0 rounded-l" style={{ background: color }} />

      <div className="flex-1 min-w-0 px-2 py-1.5">
        {/* Title row */}
        <div className="flex items-center gap-1 mb-0.5">
          <ColorPicker current={color} onPick={onColor} />

          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              className="flex-1 text-[0.72rem] font-medium text-gray-900 bg-white border border-blue-400 rounded px-1 outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={`flex-1 text-[0.72rem] font-medium truncate ${isActive ? "text-blue-900" : "text-gray-700"}`}
              onDoubleClick={startEdit}
              title="Double-click to rename"
            >
              {item.title}
            </span>
          )}

          {/* Actions — visible on hover */}
          {!editing && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                className="btn-ghost-sm text-gray-400 hover:text-gray-700"
                onClick={startEdit}
                title="Rename"
              >
                <i className="ri-pencil-line text-[0.65rem]" />
              </button>
              <button
                className="btn-ghost-sm text-red-400 hover:text-red-600"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete query"
              >
                <i className="ri-close-line" />
              </button>
            </div>
          )}
        </div>

        {/* Query preview */}
        <div className="bg-white px-1 py-0.5 rounded">
          <code className="block text-[0.58rem] text-gray-500 leading-snug line-clamp-2 break-all font-mono">
            {item.queryText.slice(0, 100)}
          </code>
        </div>

        {/* Result badge */}
        {item.lastResultMeta && (
          <div className="mt-0.5 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.lastResultMeta.ok ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-[0.58rem] text-gray-400">
              {item.lastResultMeta.ok
                ? `${item.lastResultMeta.rowCount} rows`
                : (item.lastResultMeta.errorMessage ?? "error")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const SavedQueriesList = memo(function SavedQueriesList({
  queries,
  activeQueryId,
  onNewQuery,
  onActivate,
  onRename,
  onColor,
  onDelete
}: {
  queries: SavedQuery[];
  activeQueryId: string;
  onNewQuery: () => void;
  onActivate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="pt-2">
      <div className="px-3 pb-2">
        <button className="btn w-full text-xs" onClick={onNewQuery}>
          <i className="ri-add-line" /> New query
        </button>
      </div>
      {queries.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-400">No queries yet.</p>
      ) : (
        queries.map((item) => (
          <SavedQueryItem
            key={item.id}
            item={item}
            isActive={item.id === activeQueryId}
            onActivate={() => onActivate(item.id)}
            onRename={(title) => onRename(item.id, title)}
            onColor={(color) => onColor(item.id, color)}
            onDelete={() => onDelete(item.id)}
          />
        ))
      )}
    </div>
  );
});

// ── Prefixes ──────────────────────────────────────────────────────────────────

function PrefixesList({
  prefixes,
  onAdd,
  onToggle,
  onRemove
}: {
  prefixes: PrefixEntry[];
  onAdd: () => void;
  onToggle: (prefix: string) => void;
  onRemove: (prefix: string) => void;
}) {
  return (
    <div className="pt-2">
      <div className="px-3 pb-2">
        <button className="btn w-full text-xs" onClick={onAdd}>
          <i className="ri-add-line" /> Add prefix
        </button>
      </div>
      {prefixes.length === 0 && (
        <p className="px-3 py-4 text-xs text-gray-400">No prefixes yet.</p>
      )}
      {prefixes.map((item) => {
        const active = item.enabled !== false;
        return (
          <div
            key={item.prefix}
            className={`group px-3 py-1.5 border border-gray-200 bg-zinc-100 hover:bg-gray-50 mb-1 flex items-center gap-2 ${!active ? "opacity-50" : ""}`}
          >
            <button
              className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center text-xs transition-colors ${
                active ? "bg-blue-500 border-blue-500 text-white" : "bg-white border-gray-300 text-transparent"
              }`}
              onClick={() => onToggle(item.prefix)}
              title={active ? "Disable prefix" : "Enable prefix"}
            >
              <i className="ri-check-line" />
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-mono font-medium text-gray-800">{item.prefix}:</span>
              <span className="text-[0.6rem] text-gray-400 truncate block">{item.iri}</span>
            </div>
            <button
              className="btn-ghost-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
              onClick={() => onRemove(item.prefix)}
              title="Remove prefix"
            >
              <i className="ri-close-line" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Left panel ────────────────────────────────────────────────────────────────

export function LeftPanel({
  history,
  savedQueries,
  activeQueryId,
  prefixes,
  onNewQuery,
  onActivateQuery,
  onRenameQuery,
  onColorQuery,
  onDeleteQuery,
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {view === "saved" && (
          <SavedQueriesList
            queries={savedQueries}
            activeQueryId={activeQueryId}
            onNewQuery={onNewQuery}
            onActivate={onActivateQuery}
            onRename={onRenameQuery}
            onColor={onColorQuery}
            onDelete={onDeleteQuery}
          />
        )}
        {view === "history" && <HistoryList history={history} />}
        {view === "prefixes" && (
          <PrefixesList
            prefixes={prefixes}
            onAdd={onAddPrefix}
            onToggle={onTogglePrefix}
            onRemove={onRemovePrefix}
          />
        )}
      </div>
    </div>
  );
}
