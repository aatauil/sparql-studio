import { useEffect, useState } from "react";

interface HeapMemory {
  usedMB: number;
  limitMB: number;
}

type PerfWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

function readHeap(): HeapMemory | null {
  const mem = (performance as PerfWithMemory).memory;
  if (!mem) return null;
  return {
    usedMB: Math.round(mem.usedJSHeapSize / 1_048_576),
    limitMB: Math.round(mem.jsHeapSizeLimit / 1_048_576),
  };
}

export function useHeapMemory(): HeapMemory | null {
  const [heap, setHeap] = useState<HeapMemory | null>(readHeap);

  useEffect(() => {
    if (!(performance as PerfWithMemory).memory) return;
    const id = setInterval(() => setHeap(readHeap()), 5_000);
    return () => clearInterval(id);
  }, []);

  return heap;
}
