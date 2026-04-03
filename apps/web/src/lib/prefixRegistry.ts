const CACHE_KEY = "sparql-studio:prefixcc-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  timestamp: number;
  data: Record<string, string>;
}

let memoryCache: Record<string, string> | null = null;

export async function getPrefixRegistry(): Promise<Record<string, string>> {
  if (memoryCache) return memoryCache;

  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    try {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        memoryCache = entry.data;
        return memoryCache;
      }
    } catch {
      // stale or corrupt cache, fall through to fetch
    }
  }

  const res = await fetch("https://prefix.cc/context");
  const json = await res.json();
  const data: Record<string, string> = json["@context"] ?? {};

  const entry: CacheEntry = { timestamp: Date.now(), data };
  localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  memoryCache = data;
  return memoryCache;
}
