import { memo, useState } from "react";
import type { QueryHistoryEntry } from "../../storage";
import { Button } from "../ui/button";

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
    <Button
      variant="outline"
      size="xs"
      className="shrink-0 text-gray-400 hover:text-gray-700"
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      title="Copy query to clipboard"
    >
      {copied ? <i className="ri-check-line text-[0.65rem]" /> : <i className="ri-clipboard-line text-[0.65rem]" />}
    </Button>
  );
}

function HistoryItem({
  item,
  isPreviewActive,
  onTogglePreview,
}: {
  item: QueryHistoryEntry;
  isPreviewActive: boolean;
  onTogglePreview: () => void;
}) {
  const stripeColor = item.status === "success" ? "#10b981" : "#ef4444";

  return (
    <div className="group flex items-stretch mb-1 bg-zinc-100 hover:bg-gray-50 transition-colors">
      {/* Status stripe */}
      <div className="w-1.5 shrink-0" style={{ background: stripeColor }} />

      <div className="flex-1 min-w-0 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[0.68rem] text-gray-500">
            {new Date(item.startedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span className="text-[0.68rem] text-gray-400 ml-auto">
            {item.status === "success" ? `${item.rowCount} rows` : "error"}
          </span>

          {/* Actions — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button
              variant="outline"
              size="xs"
              className={`text-gray-400 hover:text-gray-700 ${isPreviewActive ? "bg-gray-100 text-gray-700" : ""}`}
              onClick={onTogglePreview}
              title="Preview query"
            >
              <i className="ri-eye-line text-[0.65rem]" />
            </Button>
            <CopyButton text={item.queryText} />
          </div>
        </div>

        {item.error && (
          <p className="mt-0.5 text-[0.65rem] text-red-500 truncate">{item.error}</p>
        )}
      </div>
    </div>
  );
}

export const HistoryPanel = memo(function HistoryPanel({
  history,
  error,
  onPreview,
}: {
  history: QueryHistoryEntry[];
  error: string | null;
  onPreview: (text: string | null) => void;
}) {
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  function togglePreview(id: string, text: string) {
    if (previewingId === id) {
      setPreviewingId(null);
      onPreview(null);
    } else {
      setPreviewingId(id);
      onPreview(text);
    }
  }

  if (error) {
    return <p className="px-3 py-4 text-xs text-red-500">{error}</p>;
  }
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
            <HistoryItem
              key={item.id}
              item={item}
              isPreviewActive={item.id === previewingId}
              onTogglePreview={() => togglePreview(item.id, item.queryText)}
            />
          ))}
        </div>
      ))}
    </div>
  );
});
