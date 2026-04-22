import { useRef, useMemo, useState, useContext } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { isUri, compressUri } from "../query-utils";
import { ESTIMATED_ROW_HEIGHT } from "../config";
import { DisplayPrefixContext } from "../hooks/usePrefixManager";
import { Button } from "./ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

interface ResultsTableProps {
  result: SparqlJsonResult;
  onNavigateToSubject: (uri: string) => void;
}

export function ResultsTable({ result, onNavigateToSubject }: ResultsTableProps) {
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayPrefixes = useContext(DisplayPrefixContext);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerCopy(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedKey(key);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  const columns = result.head.vars;

  const rows = useMemo(() => {
    const list = [...result.results.bindings];
    if (!sortBy) return list;
    list.sort((left, right) => {
      const a = left[sortBy]?.value ?? "";
      const b = right[sortBy]?.value ?? "";
      const compare = a.localeCompare(b);
      return sortDir === "asc" ? compare : -compare;
    });
    return list;
  }, [result, sortBy, sortDir]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <div ref={scrollRef} className="overflow-auto h-full">
      <table className="w-full caption-bottom text-xs min-w-[600px] border-collapse">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} className="sticky top-0 bg-background z-10 border border-border px-2 py-[3px]">
                <Button
                  variant="ghost"
                  className="h-auto p-0 font-semibold text-xs"
                  onClick={() => {
                    if (sortBy === column) {
                      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
                    } else {
                      setSortBy(column);
                      setSortDir("asc");
                    }
                  }}
                  aria-label={`Sort by ${column}`}
                >
                  {column}{" "}
                  {sortBy === column ? <i className={sortDir === "asc" ? "ri-arrow-up-s-fill" : "ri-arrow-down-s-fill"} /> : ""}
                </Button>
              </TableHead>
            ))}
            <TableHead className="sticky top-0 bg-background z-10 border border-border px-2 py-[3px]">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (
            <TableRow><TableCell style={{ height: paddingTop }} colSpan={columns.length + 1} className="p-0" /></TableRow>
          )}
          {virtualRows.map((vRow) => {
            const row = rows[vRow.index]!;
            return (
              <TableRow key={vRow.index} data-index={vRow.index} ref={virtualizer.measureElement}>
                {columns.map((column) => {
                  const binding = row[column];
                  const value = binding?.value ?? "";
                  if (isUri(binding)) {
                    const compressed = compressUri(value, displayPrefixes);
                    const cellKey = `${vRow.index}:${column}`;
                    const isCopied = copiedKey === cellKey;
                    return (
                      <TableCell key={column} className="relative group border border-border px-2 py-[3px] align-top whitespace-normal">
                        <span>{compressed ?? value}</span>
                        {compressed && (
                          <div className="text-[0.65rem] text-muted-foreground font-mono leading-tight mt-0.5 break-all">{value}</div>
                        )}
                        <div className="absolute top-0 right-0 hidden group-hover:flex gap-0.5 p-0.5">
                          <Button
                            variant="outline"
                            size="xs"
                            title="Copy to clipboard"
                            onClick={() => triggerCopy(cellKey, "<" + value + ">")}
                          >
                            {isCopied ? "Copied!" : <i className="ri-file-copy-line" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            title="Open URI in new tab"
                            onClick={() => window.open(value, "_blank", "noreferrer")}
                          >
                            <i className="ri-external-link-line" />
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            title="Open subject page"
                            onClick={() => onNavigateToSubject(value)}
                          >
                            <i className="ri-article-line" />
                          </Button>
                        </div>
                      </TableCell>
                    );
                  }
                  const cellKey = `${vRow.index}:${column}`;
                  const isCopied = copiedKey === cellKey;
                  return (
                    <TableCell key={column} className="relative group border border-border px-2 py-[3px] align-top whitespace-normal">
                      {value}
                      {value && (
                        <div className="absolute top-0 right-0 hidden group-hover:flex gap-0.5 p-0.5 bg-background/90">
                          <Button
                            variant="outline"
                            size="xs"
                            title="Copy to clipboard"
                            onClick={() => triggerCopy(cellKey, value)}
                          >
                            {isCopied ? "Copied!" : <i className="ri-file-copy-line" />}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="border border-border px-2 py-[3px] align-top">
                  {(() => {
                    const rowKey = `row:${vRow.index}`;
                    return (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          const values = columns.map((col) => row[col]?.value ?? "");
                          triggerCopy(rowKey, values.join("\t"));
                        }}
                      >
                        {copiedKey === rowKey ? "Copied!" : "Copy row"}
                      </Button>
                    );
                  })()}
                </TableCell>
              </TableRow>
            );
          })}
          {paddingBottom > 0 && (
            <TableRow><TableCell style={{ height: paddingBottom }} colSpan={columns.length + 1} className="p-0" /></TableRow>
          )}
        </TableBody>
      </table>
    </div>
  );
}
