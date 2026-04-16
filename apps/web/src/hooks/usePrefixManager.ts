import { createContext, useEffect, useMemo, useState } from "react";
import { prefixStore, type PrefixEntry } from "../storage";
import { PREFIX_ON_KEY } from "../config";
import { getPrefixRegistry } from "../lib/prefixRegistry";

export type DisplayPrefix = { iri: string; prefix: string };
export const DisplayPrefixContext = createContext<DisplayPrefix[]>([]);

export function useDisplayPrefixes(
  localPrefixes: PrefixEntry[],
  globalOn: boolean
): DisplayPrefix[] {
  const [registryList, setRegistryList] = useState<DisplayPrefix[]>([]);

  useEffect(() => {
    getPrefixRegistry()
      .then((reg) => {
        setRegistryList(
          Object.entries(reg).map(([prefix, iri]) => ({ iri: String(iri), prefix }))
        );
      })
      .catch(() => {});
  }, []);

  return useMemo(() => {
    if (!globalOn) return [];
    const map = new Map<string, string>();
    for (const { iri, prefix } of registryList) map.set(iri, prefix);
    for (const p of localPrefixes) {
      if (p.enabled !== false) map.set(p.iri, p.prefix);
    }
    return [...map.entries()]
      .map(([iri, prefix]) => ({ iri, prefix }))
      .sort((a, b) => b.iri.length - a.iri.length);
  }, [registryList, localPrefixes, globalOn]);
}

// Standalone version for route pages that live outside App's context provider.
// Loads local prefixes from storage and global toggle from localStorage once on mount.
export function usePageDisplayPrefixes(): DisplayPrefix[] {
  const [localPrefixes, setLocalPrefixes] = useState<PrefixEntry[]>([]);
  const [globalOn] = useState(() => localStorage.getItem(PREFIX_ON_KEY) !== "false");

  useEffect(() => {
    prefixStore.list().then((list) => {
      setLocalPrefixes(list.length > 0 ? list : [...defaultPrefixes]);
    }).catch(() => {});
  }, []);

  return useDisplayPrefixes(localPrefixes, globalOn);
}

const defaultPrefixes: PrefixEntry[] = [
  { prefix: "rdf", iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", source: "local", updatedAt: Date.now(), enabled: true },
  { prefix: "rdfs", iri: "http://www.w3.org/2000/01/rdf-schema#", source: "local", updatedAt: Date.now(), enabled: true }
];

export function applyPrefixes(queryText: string, prefixes: PrefixEntry[]): string {
  const active = prefixes.filter((p) => p.enabled !== false);
  if (active.length === 0) return queryText;
  const prefixText = active.map((p) => `PREFIX ${p.prefix}: <${p.iri}>`).join("\n");
  return `${prefixText}\n${queryText}`.trim();
}

export interface PrefixManager {
  prefixes: PrefixEntry[];
  globalPrefixesOn: boolean;
  activePrefixCount: number;
  error: string | null;
  savePrefix: (prefix: string, iri: string) => Promise<void>;
  addPrefix: () => Promise<void>;
  togglePrefix: (prefix: string) => Promise<void>;
  removePrefix: (prefix: string) => Promise<void>;
  toggleGlobalPrefixes: () => void;
  applyPrefixesIfEnabled: (queryText: string) => string;
}

export function usePrefixManager(settingsLoaded: boolean): PrefixManager {
  const [prefixes, setPrefixes] = useState<PrefixEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [globalPrefixesOn, setGlobalPrefixesOn] = useState(
    () => localStorage.getItem(PREFIX_ON_KEY) !== "false"
  );

  useEffect(() => {
    if (!settingsLoaded) return;
    (async () => {
      try {
        const prefixList = await prefixStore.list();
        if (prefixList.length === 0) {
          for (const p of defaultPrefixes) {
            await prefixStore.upsert(p);
          }
          setPrefixes([...defaultPrefixes].sort((a, b) => a.prefix.localeCompare(b.prefix)));
        } else {
          setPrefixes(prefixList.sort((a, b) => a.prefix.localeCompare(b.prefix)));
        }
      } catch {
        setError("Could not load prefix library.");
      }
    })();
  }, [settingsLoaded]);

  async function savePrefix(prefix: string, iri: string) {
    const item: PrefixEntry = { prefix, iri, source: "local", updatedAt: Date.now(), enabled: true };
    await prefixStore.upsert(item);
    setPrefixes((prev) =>
      [...prev.filter((e) => e.prefix !== prefix), item].sort((a, b) => a.prefix.localeCompare(b.prefix))
    );
  }

  async function addPrefix() {
    const prefix = prompt("Prefix (e.g. foaf)")?.trim();
    const iri = prompt("IRI (e.g. http://xmlns.com/foaf/0.1/)")?.trim();
    if (!prefix || !iri) return;
    await savePrefix(prefix, iri);
  }

  async function togglePrefix(prefix: string) {
    setPrefixes((prev) => {
      const updated = prev.map((p) =>
        p.prefix === prefix ? { ...p, enabled: p.enabled === false ? true : false } : p
      );
      const item = updated.find((p) => p.prefix === prefix)!;
      void prefixStore.upsert(item);
      return updated;
    });
  }

  async function removePrefix(prefix: string) {
    await prefixStore.remove(prefix);
    setPrefixes((prev) => prev.filter((p) => p.prefix !== prefix));
  }

  function toggleGlobalPrefixes() {
    const next = !globalPrefixesOn;
    setGlobalPrefixesOn(next);
    localStorage.setItem(PREFIX_ON_KEY, String(next));
  }

  const activePrefixCount = prefixes.filter((p) => p.enabled !== false).length;

  function applyPrefixesIfEnabled(queryText: string): string {
    return globalPrefixesOn ? applyPrefixes(queryText, prefixes) : queryText;
  }

  return {
    prefixes,
    globalPrefixesOn,
    activePrefixCount,
    error,
    savePrefix,
    addPrefix,
    togglePrefix,
    removePrefix,
    toggleGlobalPrefixes,
    applyPrefixesIfEnabled
  };
}
