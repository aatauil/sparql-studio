import type { SparqlBinding, SparqlJsonResult } from "@sparql-studio/contracts";

const RS = "http://www.w3.org/2001/sw/DataAccess/tests/result-set#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function formatRdfValue(b: SparqlBinding): { turtle: string; nt: string } {
  if (b.type === "uri") return { turtle: `<${b.value}>`, nt: `<${b.value}>` };
  if (b.type === "bnode") return { turtle: `_:${b.value}`, nt: `_:${b.value}` };
  const esc = escapeLiteral(b.value);
  const suffix = b["xml:lang"] ? `@${b["xml:lang"]}` : b.datatype ? `^^<${b.datatype}>` : "";
  return { turtle: `"${esc}"${suffix}`, nt: `"${esc}"${suffix}` };
}

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

export function toTsv(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const header = cols.map((c) => `?${c}`).join("\t");
  const rows = result.results.bindings.map((row) =>
    cols
      .map((col) => {
        const b = row[col];
        if (!b) return "";
        if (b.type === "uri") return `<${b.value}>`;
        if (b.type === "bnode") return `_:${b.value}`;
        const suffix = b["xml:lang"] ? `@${b["xml:lang"]}` : b.datatype ? `^^<${b.datatype}>` : "";
        return `"${b.value.replace(/\t/g, "\\t").replace(/\n/g, "\\n")}"${suffix}`;
      })
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

export function toJson(result: SparqlJsonResult): string {
  return JSON.stringify(result, null, 2);
}

export function toXml(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const varLines = cols.map((v) => `    <variable name="${escapeXml(v)}"/>`).join("\n");
  const resultLines = result.results.bindings.map((row) => {
    const bindings = cols
      .filter((col) => row[col])
      .map((col) => {
        const b = row[col]!;
        let inner: string;
        if (b.type === "uri") inner = `<uri>${escapeXml(b.value)}</uri>`;
        else if (b.type === "bnode") inner = `<bnode>${escapeXml(b.value)}</bnode>`;
        else {
          const lang = b["xml:lang"] ? ` xml:lang="${escapeXml(b["xml:lang"])}"` : "";
          const dt = b.datatype ? ` datatype="${escapeXml(b.datatype)}"` : "";
          inner = `<literal${lang}${dt}>${escapeXml(b.value)}</literal>`;
        }
        return `      <binding name="${escapeXml(col)}">${inner}</binding>`;
      })
      .join("\n");
    return `    <result>\n${bindings}\n    </result>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sparql xmlns="http://www.w3.org/2005/sparql-results#">\n  <head>\n${varLines}\n  </head>\n  <results>\n${resultLines}\n  </results>\n</sparql>`;
}

export function toTurtle(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const lines: string[] = [
    `@prefix rdf: <${RDF}> .`,
    `@prefix rs: <${RS}> .`,
    "",
    `_:rs rdf:type rs:ResultSet ;`,
    ...cols.map((v, i) => `    rs:resultVariable "${v}"${i < cols.length - 1 ? " ;" : " ."}`),
    "",
  ];
  result.results.bindings.forEach((row, ri) => {
    lines.push(`_:rs rs:solution _:sol${ri} .`);
    cols.forEach((col, bi) => {
      const b = row[col];
      if (!b) return;
      lines.push(`_:sol${ri} rs:binding _:b${ri}_${bi} .`);
      lines.push(`_:b${ri}_${bi} rs:variable "${col}" ;`);
      lines.push(`    rs:value ${formatRdfValue(b).turtle} .`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

export function toRdfXml(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const varDecls = cols.map((v) => `    <rs:resultVariable>${escapeXml(v)}</rs:resultVariable>`).join("\n");
  const solutions = result.results.bindings.map((row, ri) => {
    const bindings = cols
      .filter((col) => row[col])
      .map((col, bi) => {
        const b = row[col]!;
        let valueEl: string;
        if (b.type === "uri") valueEl = `<rs:value rdf:resource="${escapeXml(b.value)}"/>`;
        else if (b.type === "bnode") valueEl = `<rs:value rdf:nodeID="${escapeXml(b.value)}"/>`;
        else {
          const lang = b["xml:lang"] ? ` xml:lang="${escapeXml(b["xml:lang"])}"` : "";
          const dt = b.datatype ? ` rdf:datatype="${escapeXml(b.datatype)}"` : "";
          valueEl = `<rs:value${lang}${dt}>${escapeXml(b.value)}</rs:value>`;
        }
        return `      <rs:binding rdf:nodeID="b${ri}_${bi}">\n        <rs:variable>${escapeXml(col)}</rs:variable>\n        ${valueEl}\n      </rs:binding>`;
      })
      .join("\n");
    return `    <rs:Solution rdf:nodeID="sol${ri}">\n${bindings}\n    </rs:Solution>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF xmlns:rdf="${RDF}" xmlns:rs="${RS}">\n  <rs:ResultSet>\n${varDecls}\n${solutions}\n  </rs:ResultSet>\n</rdf:RDF>`;
}

export function toNTriples(result: SparqlJsonResult): string {
  const cols = result.head.vars;
  const lines: string[] = [];
  lines.push(`_:rs <${RDF}type> <${RS}ResultSet> .`);
  cols.forEach((v) => lines.push(`_:rs <${RS}resultVariable> "${v}" .`));
  result.results.bindings.forEach((row, ri) => {
    lines.push(`_:rs <${RS}solution> _:sol${ri} .`);
    cols.forEach((col, bi) => {
      const b = row[col];
      if (!b) return;
      lines.push(`_:sol${ri} <${RS}binding> _:b${ri}_${bi} .`);
      lines.push(`_:b${ri}_${bi} <${RS}variable> "${col}" .`);
      lines.push(`_:b${ri}_${bi} <${RS}value> ${formatRdfValue(b).nt} .`);
    });
  });
  return lines.join("\n");
}
