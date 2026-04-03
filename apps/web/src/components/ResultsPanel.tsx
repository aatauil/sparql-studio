import { useState } from "react";
import type { SparqlJsonResult } from "@sparql-studio/contracts";
import { toCsv } from "../query-utils";
import { ResultsTable } from "./ResultsTable";

export interface ResultMeta {
  durationMs: number;
  rowCount: number;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface ResultsPanelProps {
  result: SparqlJsonResult | null;
  meta: ResultMeta | null;
  onNavigateToSubject: (uri: string) => void;
}

type ResultsView = "table" | "json";

function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function ResultsPanel({ result, meta, onNavigateToSubject }: ResultsPanelProps) {
  const [view, setView] = useState<ResultsView>("table");
  const [exportOpen, setExportOpen] = useState(false);

  const errorLabel =
    meta?.errorCode === "TIMEOUT"
      ? "Timed out"
      : meta?.errorCode === "ENDPOINT_UNREACHABLE"
        ? "Unreachable"
        : "Error";

  return (
    <div className="h-full flex flex-col overflow-hidden border-t border-gray-200 bg-zinc-100">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center border-b border-gray-200 bg-gray-50">
        {/* Tabs */}
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            view === "table"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("table")}
        >
          <i className="ri-table-2" /> Table
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            view === "json"
              ? "border-blue-500 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setView("json")}
        >
          <i className="ri-braces-line" /> JSON
        </button>

        {/* Export */}
        <div className="relative ml-2">
          <button
            className="btn"
            disabled={!result}
            onClick={() => setExportOpen((v) => !v)}
          >
            <i className="ri-download-2-line" /> Export
          </button>
          {exportOpen && result && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded shadow-md min-w-[110px]">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
                  onClick={() => {
                    downloadText(`results-${Date.now()}.csv`, toCsv(result), "text/csv;charset=utf-8");
                    setExportOpen(false);
                  }}
                >
                  <i className="ri-file-text-line" /> CSV
                </button>
              </div>
            </>
          )}
        </div>

        {/* Meta */}
        {meta && (
          <div className="ml-auto flex items-center gap-2 px-3 text-xs">
            {meta.ok ? (
              <span className="flex items-center gap-1 text-green-700">
                <i className="ri-checkbox-circle-line" /> Success
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-600">
                <i className="ri-error-warning-line" /> {errorLabel}
              </span>
            )}
            {meta.ok && (
              <span className="text-gray-500">{meta.rowCount} rows</span>
            )}
            <span className="text-gray-400">{meta.durationMs}ms</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto" role="region" aria-label="SPARQL query results">
        {!result && <p className="p-3 text-gray-500">No results yet.</p>}
        {result && view === "table" && (
          <ResultsTable result={result} onNavigateToSubject={onNavigateToSubject} />
        )}
        {result && view === "json" && (
          <pre className="text-xs p-4 whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
