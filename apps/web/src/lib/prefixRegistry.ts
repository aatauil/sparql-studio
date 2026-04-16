const CACHE_KEY = "sparql-studio:prefixcc-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  timestamp: number;
  data: Record<string, string>;
}

// Common RDF prefixes bundled as a reliable fallback.
const BUILTIN_PREFIXES: Record<string, string> = {
  rdf:     "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs:    "http://www.w3.org/2000/01/rdf-schema#",
  owl:     "http://www.w3.org/2002/07/owl#",
  xsd:     "http://www.w3.org/2001/XMLSchema#",
  foaf:    "http://xmlns.com/foaf/0.1/",
  dc:      "http://purl.org/dc/elements/1.1/",
  dct:     "http://purl.org/dc/terms/",
  dcterms: "http://purl.org/dc/terms/",
  skos:    "http://www.w3.org/2004/02/skos/core#",
  schema:  "http://schema.org/",
  geo:     "http://www.w3.org/2003/01/geo/wgs84_pos#",
  vcard:   "http://www.w3.org/2006/vcard/ns#",
  void:    "http://rdfs.org/ns/void#",
  prov:    "http://www.w3.org/ns/prov#",
  dcat:    "http://www.w3.org/ns/dcat#",
  org:     "http://www.w3.org/ns/org#",
  qb:      "http://purl.org/linked-data/cube#",
  sioc:    "http://rdfs.org/sioc/ns#",
  bibo:    "http://purl.org/ontology/bibo/",
  wgs:     "http://www.w3.org/2003/01/geo/wgs84_pos#",
  gr:      "http://purl.org/goodrelations/v1#",
  time:    "http://www.w3.org/2006/time#",
  frbr:    "http://purl.org/vocab/frbr/core#",
  doap:    "http://usefulinc.com/ns/doap#",
  vs:      "http://www.w3.org/2003/06/sw-vocab-status/ns#",
  wdrs:    "http://www.w3.org/2007/05/powder-s#",
  cc:      "http://creativecommons.org/ns#",
  event:   "http://purl.org/NET/c4dm/event.owl#",
  mo:      "http://purl.org/ontology/mo/",
};

let memoryCache: Record<string, string> | null = null;

export async function getPrefixRegistry(): Promise<Record<string, string>> {
  if (memoryCache) return memoryCache;

  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    try {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS && Object.keys(entry.data).length > 0) {
        memoryCache = entry.data;
        return memoryCache;
      }
    } catch {
      // stale or corrupt cache, fall through
    }
  }

  // Start with built-in prefixes so we always have a working baseline.
  const merged: Record<string, string> = { ...BUILTIN_PREFIXES };

  try {
    const res = await fetch("https://prefix.cc/context");
    const json = await res.json();
    const remote: Record<string, string> = json["@context"] ?? {};
    if (Object.keys(remote).length > 0) {
      Object.assign(merged, remote);
    }
  } catch {
    // prefix.cc unreachable or has an invalid cert — built-ins are the fallback.
  }

  const entry: CacheEntry = { timestamp: Date.now(), data: merged };
  localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  memoryCache = merged;
  return memoryCache;
}
