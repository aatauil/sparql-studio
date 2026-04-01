import type { SparqlBinding, SparqlJsonResult } from "@sparql-studio/contracts";

export function isUri(binding?: SparqlBinding): boolean {
  return binding?.type === "uri" || /^https?:\/\//.test(binding?.value ?? "");
}

export function toCsv(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const rows = result.results.bindings.map((row) =>
    cols
      .map((col) => {
        const value = row[col]?.value ?? "";
        const escaped = value.replaceAll('"', '""');
        return `"${escaped}"`;
      })
      .join(",")
  );
  return [cols.join(","), ...rows].join("\n");
}
