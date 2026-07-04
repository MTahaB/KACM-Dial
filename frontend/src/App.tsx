// One screen, zero navigation (SPEC §7): paste/ingest → progress ("the document
// develops like a photo") → Reader. Talks only to the local backend; works offline.

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Reader from "./components/Reader";

const SAMPLE = `# Notification de trop-perçu

Madame, Monsieur,

Suite au réexamen de votre dossier, la Caisse constate un trop-perçu de 1 240,50 € au titre de la période de janvier à mars 2026. En application de l'article L.553-2 du code de la sécurité sociale, cette somme doit être remboursée dans un délai de 30 jours à compter de la notification.

À défaut de remboursement dans le délai imparti, la Caisse procédera au recouvrement par retenues sur vos prestations à venir, dans la limite de la quotité saisissable prévue par la réglementation en vigueur.

Vous disposez d'un délai de deux mois pour contester cette décision devant la commission de recours amiable, par lettre recommandée avec accusé de réception.`;

type Phase = "ingest" | "generating" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("ingest");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, pct: 0 });
  const pollRef = useRef<number | null>(null);

  async function handleIngest() {
    if (!text.trim()) return;
    const t = title.trim() || firstLine(text);
    const res = await api.ingest(text, t);
    setDocId(res.doc_id);
    setPhase("generating");
  }

  // Poll /status at 500ms (no websockets — §4).
  useEffect(() => {
    if (phase !== "generating" || !docId) return;
    const tick = async () => {
      const s = await api.status(docId);
      setProgress({
        done: s.paragraphs_done,
        total: s.total_jobs,
        pct: Math.round(s.progress * 100),
      });
      if (s.progress >= 1) {
        setPhase("ready");
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [phase, docId]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Dial<span>reading level is a property of your gaze</span>
        </div>
        <div className="pill">
          <span className="dot" /> local — no network
        </div>
      </header>

      {phase === "ingest" && (
        <section className="ingest">
          <textarea
            placeholder="Paste a document (.txt / .md text)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row">
            <button className="primary" onClick={handleIngest} disabled={!text.trim()}>
              Read at every level →
            </button>
            <button
              className="sample-chip"
              onClick={() => {
                setText(SAMPLE);
                setTitle("Notification de trop-perçu — CAF");
              }}
            >
              Load sample (FR administrative letter)
            </button>
          </div>
        </section>
      )}

      {phase === "generating" && (
        <section className="progress-wrap">
          <div className="progress-label">
            <span>Generating every reading level locally…</span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${progress.pct}%` }} />
          </div>
        </section>
      )}

      {phase === "ready" && docId && <Reader docId={docId} />}
    </div>
  );
}

function firstLine(t: string): string {
  const line = t.trim().split("\n")[0].replace(/^#{1,6}\s+/, "").trim();
  return line.slice(0, 80) || "Untitled";
}
