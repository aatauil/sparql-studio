import { memo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SavedQuery } from "../../storage";

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

export const QueriesPanel = memo(function QueriesPanel({
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
