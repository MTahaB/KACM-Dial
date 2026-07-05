// One screen, zero navigation (SPEC §7): paste / upload / drop a .txt or .md →
// the document develops in place (§3.3) → Reader. Talks only to the local
// backend; works fully offline.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Reader from "./components/Reader";
import { SAMPLES } from "./samples";

type Phase = "ingest" | "generating" | "ready";

const ACCEPTED = [".txt", ".md", ".markdown"];

export default function App() {
  const [phase, setPhase] = useState<Phase>("ingest");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, pct: 0 });
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  async function handleIngest() {
    if (!text.trim()) return;
    const t = title.trim() || firstLine(text);
    const res = await api.ingest(text, t);
    setDocId(res.doc_id);
    setPhase("generating");
  }

  const readFile = useCallback(async (file: File) => {
    setFileError(null);
    const name = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setFileError(`"${file.name}" — only .txt and .md files (PDF is out of scope, on purpose).`);
      return;
    }
    const content = await file.text();
    setText(content);
    setTitle(firstLine(content) || file.name.replace(/\.(txt|md|markdown)$/i, ""));
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile]
  );

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
      if (s.progress >= 1) setPhase("ready");
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
          Dial<i className="brand-dot">.</i>
          <span>reading level is a property of your gaze</span>
        </div>
        <div className="pill">
          <span className="dot" /> local — no network
        </div>
      </header>

      {phase === "ingest" && (
        <section className="ingest">
          <div
            className={`dropzone ${dragging ? "dragover" : ""} ${text ? "has-text" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <textarea
              placeholder="Paste a document, or drop a .txt / .md file here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Document text"
            />
            {dragging && (
              <div className="drop-hint" aria-hidden>
                <span>⬇ drop to load</span>
              </div>
            )}
          </div>

          {fileError && <div className="file-error">{fileError}</div>}

          <div className="row">
            <button className="primary" onClick={handleIngest} disabled={!text.trim()}>
              Read at every level →
            </button>
            <button className="ghost" onClick={() => fileInput.current?.click()}>
              📎 Open a file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(",")}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
                e.target.value = "";
              }}
            />
            <span className="row-sep" aria-hidden />
            {SAMPLES.map((s) => (
              <button
                key={s.key}
                className="sample-chip"
                onClick={() => {
                  setText(s.text);
                  setTitle(s.title);
                  setFileError(null);
                }}
              >
                {s.chip}
              </button>
            ))}
          </div>

          <p className="tagline">
            Gemma writes. Nemotron verifies. <b>Nothing leaves this machine.</b>
          </p>
        </section>
      )}

      {phase === "generating" && (
        <section className="progress-wrap slim">
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

      {/* Photo-develop (§3.3): the reader mounts as soon as ingestion starts;
          paragraphs develop in place as the local models finish them. */}
      {(phase === "generating" || phase === "ready") && docId && (
        <Reader
          docId={docId}
          developing={phase === "generating"}
          initialLevel="standard"
        />
      )}
    </div>
  );
}

function firstLine(t: string): string {
  const line = t.trim().split("\n")[0].replace(/^#{1,6}\s+/, "").trim();
  return line.slice(0, 80) || "Untitled";
}
