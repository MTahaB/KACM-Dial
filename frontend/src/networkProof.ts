// Live locality proof. Counts resource fetches that LEAVE the machine —
// anything not addressed to localhost. The header pill renders this number;
// it must read 0 forever. This is a measurement, not a promise.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

let outgoing = 0;
const listeners = new Set<(n: number) => void>();

function isOutgoing(url: string): boolean {
  try {
    return !LOCAL_HOSTS.has(new URL(url, window.location.href).hostname);
  } catch {
    return false;
  }
}

// Count everything already fetched before we subscribed, then observe live.
if (typeof PerformanceObserver !== "undefined") {
  for (const e of performance.getEntriesByType("resource")) {
    if (isOutgoing(e.name)) outgoing++;
  }
  const obs = new PerformanceObserver((list) => {
    let hit = false;
    for (const e of list.getEntries()) {
      if (isOutgoing(e.name)) {
        outgoing++;
        hit = true;
      }
    }
    if (hit) listeners.forEach((fn) => fn(outgoing));
  });
  obs.observe({ type: "resource", buffered: false });
}

export function outgoingRequests(): number {
  return outgoing;
}

export function onOutgoingChange(fn: (n: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
