import { useMemo, useState } from "react";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { isUri } from "../query-utils";

interface ResultsTableProps {
  result: SparqlJsonResult;
  onNavigateToSubject: (uri: string) => void;
}

export function ResultsTable({ result, onNavigateToSubject }: ResultsTableProps) {
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  return (
    <table className="border-collapse w-full min-w-[600px] text-xs leading-snug">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} className="border border-gray-300 px-2 py-[3px] text-left">
              <button
                className="bg-transparent border-none font-semibold cursor-pointer p-0"
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
                {column} {sortBy === column ? <i className={sortDir === "asc" ? "ri-arrow-up-s-fill" : "ri-arrow-down-s-fill"} /> : ""}
              </button>
            </th>
          ))}
          <th className="border border-gray-300 px-2 py-[3px] text-left">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {columns.map((column) => {
              const binding = row[column];
              const value = binding?.value ?? "";
              if (isUri(binding)) {
                return (
                  <td key={column} className="relative group border border-gray-300 px-2 py-[3px] align-top">
                    {value}
                    <div className="absolute top-0 right-0 hidden group-hover:flex gap-0.5 p-0.5">
                      <button
                        className="btn-ghost-sm"
                        title="Copy to clipboard"
                        onClick={() => void navigator.clipboard.writeText("<" + value + ">")}
                      >
                        <i className="ri-file-copy-line" />
                      </button>
                      <button
                        className="btn-ghost-sm"
                        title="Open URI in new tab"
                        onClick={() => window.open(value, "_blank", "noreferrer")}
                      >
                        <i className="ri-external-link-line" />
                      </button>
                      <button
                        className="btn-ghost-sm"
                        title="Open subject page"
                        onClick={() => onNavigateToSubject(value)}
                      >
                        <i className="ri-article-line" />
                      </button>
                    </div>
                  </td>
                );
              }
              return (
                <td key={column} className="relative group border border-gray-300 px-2 py-[3px] align-top">
                  {value}
                  {value && (
                    <div className="absolute top-0 right-0 hidden group-hover:flex gap-0.5 p-0.5 bg-white/90">
                      <button
                        className="btn-ghost-sm"
                        title="Copy to clipboard"
                        onClick={() => void navigator.clipboard.writeText(value)}
                      >
                        <i className="ri-file-copy-line" />
                      </button>
                    </div>
                  )}
                </td>
              );
            })}
            <td className="border border-gray-300 px-2 py-[3px] align-top">
              <button
                className="btn-ghost-sm"
                onClick={() => {
                  const values = columns.map((col) => row[col]?.value ?? "");
                  void navigator.clipboard.writeText(values.join("\t"));
                }}
              >
                Copy row
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
