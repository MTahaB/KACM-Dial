// Trust report — the judge's screenshot. A paper card that rises from the
// bottom. Four big display numbers count up from zero over 600ms — except the
// "0 outgoing requests", which stays still while the others climb. That
// stillness is the punchline; don't animate it.

import { useEffect, useRef, useState } from "react";
import { api, LEVELS, type DocResponse, type MetricsResponse } from "../api";
import { outgoingRequests } from "../networkProof";

function useCountUp(target: number | null, animate: boolean): number {
  const [n, setN] = useState(animate ? 0 : target ?? 0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    if (!animate) {
      setN(target);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * target));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, animate]);
  return n;
}

export default function TrustReport({
  docId,
  title,
  durationS,
  onClose,
}: {
  docId: string;
  title: string;
  durationS: number | null;
  onClose: () => void;
}) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [doc, setDoc] = useState<DocResponse | null>(null);

  useEffect(() => {
    api.metrics(docId).then(setMetrics).catch(() => {});
    api.doc(docId, "simple").then(setDoc).catch(() => {});
  }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const seals = doc?.invariants.length ?? null;
  const violations = metrics?.n_seal_violations_caught ?? 0;
  const preserved = seals !== null ? seals - violations : null;
  const outgoing = outgoingRequests();

  const nPreserved = useCountUp(preserved, true);
  const nAudited = useCountUp(metrics?.n_rewrites ?? null, true);
  const nFlagged = useCountUp(metrics?.n_uncertain ?? null, true);
  // outgoing does NOT animate — the still zero is the point.

  async function exportDial() {
    const levels: Record<string, DocResponse> = {};
    for (const l of LEVELS) levels[l] = await api.doc(docId, l);
    const bundle = { format: "dial/1", title, exported_at: new Date().toISOString(), metrics, levels };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "document"}.dial`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="trust-card"
        role="dialog"
        aria-label="Trust report"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Trust report</h2>
        <div className="trust-grid">
          <div className="trust-cell">
            <div className="num good">{preserved !== null ? nPreserved : "—"}</div>
            <div className="lbl">sealed facts preserved</div>
          </div>
          <div className="trust-cell">
            <div className="num">{metrics ? nAudited : "—"}</div>
            <div className="lbl">paragraphs audited</div>
          </div>
          <div className="trust-cell">
            <div className={`num ${(metrics?.n_uncertain ?? 0) > 0 ? "warn" : "good"}`}>
              {metrics ? nFlagged : "—"}
            </div>
            <div className="lbl">passages flagged</div>
          </div>
          <div className="trust-cell">
            <div className={`num ${outgoing === 0 ? "good" : "warn"}`}>{outgoing}</div>
            <div className="lbl">outgoing requests</div>
          </div>
        </div>
        <div className="trust-foot">
          Writer <b>{metrics?.model_writer ?? "…"}</b> · Auditor{" "}
          <b>{metrics?.model_auditor ?? "…"}</b>
          {durationS !== null && <> · {formatDuration(durationS)}</>}
          <br />
          Fidelity auditing is a heuristic dual-model check with explicit
          abstention — not a formal guarantee.
        </div>
        <div className="trust-actions">
          <button onClick={exportDial}>Export report</button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
