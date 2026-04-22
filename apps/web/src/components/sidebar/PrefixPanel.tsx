import type { PrefixEntry } from "../../storage";
import { Button } from "../ui/button";

export function PrefixPanel({
  prefixes,
  error,
  onAdd,
  onToggle,
  onRemove
}: {
  prefixes: PrefixEntry[];
  error: string | null;
  onAdd: () => void;
  onToggle: (prefix: string) => void;
  onRemove: (prefix: string) => void;
}) {
  return (
    <div className="pt-2">
      <div className="px-3 pb-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onAdd} disabled={error !== null}>
          <i className="ri-add-line" /> Add prefix
        </Button>
      </div>
      {error && (
        <p className="px-3 py-4 text-xs text-red-500">{error}</p>
      )}
      {!error && prefixes.length === 0 && (
        <p className="px-3 py-4 text-xs text-gray-400">No prefixes yet.</p>
      )}
      {!error && prefixes.map((item) => {
        const active = item.enabled !== false;
        return (
          <div
            key={item.prefix}
            className={`group px-3 py-1.5 border border-gray-200 bg-zinc-100 hover:bg-gray-50 mb-1 flex items-center gap-2 ${!active ? "opacity-50" : ""}`}
          >
            <Button
              variant="ghost"
              className={`shrink-0 size-5 rounded border p-0 ${
                active ? "bg-blue-500 border-blue-500 text-white hover:bg-blue-600" : "bg-white border-gray-300 text-transparent"
              }`}
              onClick={() => onToggle(item.prefix)}
              title={active ? "Disable prefix" : "Enable prefix"}
            >
              <i className="ri-check-line text-xs" />
            </Button>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-mono font-medium text-gray-800">{item.prefix}:</span>
              <span className="text-[0.6rem] text-gray-400 truncate block">{item.iri}</span>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
              onClick={() => onRemove(item.prefix)}
              title="Remove prefix"
            >
              <i className="ri-close-line" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
