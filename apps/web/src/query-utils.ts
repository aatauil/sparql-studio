import type { SparqlBinding, SparqlJsonResult } from "@sparql-studio/contracts";

export function shortLabel(uri: unknown): string {
  if (typeof uri !== "string") return String(uri ?? "");
  const afterHash = uri.split("#").pop() ?? "";
  const afterSlash = uri.split("/").pop() ?? "";
  const local = afterHash.length > 1 ? afterHash : afterSlash;
  return local.length > 0 && local.length < 60 ? local : uri.slice(0, 50) + "…";
}

export function getBindingValue(binding: Record<string, unknown>, key: string): string {
  const val = binding[key];
  if (val && typeof val === "object" && "value" in val) return String((val as { value: unknown }).value);
  return "";
}

export function isUri(binding?: SparqlBinding): boolean {
  return binding?.type === "uri" || /^https?:\/\//.test(binding?.value ?? "");
}

export function compressUri(
  uri: string,
  prefixes: Array<{ iri: string; prefix: string }>
): string | null {
  for (const { iri, prefix } of prefixes) {
    if (uri.startsWith(iri)) return `${prefix}:${uri.slice(iri.length)}`;
  }
  return null;
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
