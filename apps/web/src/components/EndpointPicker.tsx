import { useEffect, useRef, useState } from "react";
import type { EndpointEntry } from "../storage";

interface EndpointPickerProps {
  endpoints: EndpointEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: (label: string, url: string) => Promise<void>;
  onRemove: (id: string) => void;
}

export function EndpointPicker({ endpoints, activeId, onSelect, onAdd, onRemove }: EndpointPickerProps) {
  const [open, setOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const active = endpoints.find((e) => e.id === activeId);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function handleAdd() {
    const label = addLabel.trim();
    const url = addUrl.trim();
    if (!label || !url) return;
    await onAdd(label, url);
    setAddLabel("");
    setAddUrl("");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        className="btn-dark flex items-center gap-1.5 max-w-[220px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate text-xs">{active?.label ?? active?.url ?? "Select endpoint"}</span>
        <i className="ri-arrow-down-s-line shrink-0 opacity-60 text-sm" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-72 bg-[#2d2d2d] border border-[#555] rounded shadow-lg z-50"
          role="listbox"
        >
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#3c3c3c] ${
                ep.id === activeId ? "bg-[#3c3c3c] border-l-2 border-blue-400" : ""
              }`}
              role="option"
              aria-selected={ep.id === activeId}
              onClick={() => { onSelect(ep.id); setOpen(false); }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#ccc] truncate">{ep.label}</p>
                <p className="text-[0.6rem] text-[#888] truncate">{ep.url}</p>
              </div>
              {endpoints.length > 1 && (
                <button
                  className="shrink-0 ml-2 text-[#888] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); onRemove(ep.id); }}
                  title="Remove endpoint"
                >
                  <i className="ri-close-line" />
                </button>
              )}
            </div>
          ))}

          <div className="border-t border-[#444] p-2 flex flex-col gap-1.5">
            <input
              className="w-full bg-[#1e1e1e] border border-[#555] rounded px-2 py-1 text-xs text-[#ccc] placeholder-[#666] focus:outline-none focus:border-blue-500"
              placeholder="Label (e.g. Wikidata)"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            />
            <input
              className="w-full bg-[#1e1e1e] border border-[#555] rounded px-2 py-1 text-xs text-[#ccc] placeholder-[#666] focus:outline-none focus:border-blue-500"
              placeholder="URL (e.g. https://query.wikidata.org/sparql)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            />
            <button
              className="btn-dark text-xs py-1"
              onClick={() => void handleAdd()}
            >
              Add endpoint
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
