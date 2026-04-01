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
    <table className="border-collapse w-full min-w-[600px]">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} className="border border-gray-300 p-1.5 text-left">
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
                {column} {sortBy === column ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </button>
            </th>
          ))}
          <th className="border border-gray-300 p-1.5 text-left">Actions</th>
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
                  <td key={column} className="border border-gray-300 p-1.5 align-top">
                    <span className="flex items-center gap-1 flex-wrap">
                      <a href={value} target="_blank" rel="noreferrer" className="break-all">
                        {value}
                      </a>
                      <button
                        className="btn-ghost-sm shrink-0"
                        title="Open subject page"
                        onClick={() => onNavigateToSubject(value)}
                      >
                        ↗
                      </button>
                    </span>
                  </td>
                );
              }
              return (
                <td key={column} className="border border-gray-300 p-1.5 align-top">
                  {value}
                </td>
              );
            })}
            <td className="border border-gray-300 p-1.5 align-top">
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
