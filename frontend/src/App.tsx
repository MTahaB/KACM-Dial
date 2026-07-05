// One screen, zero navigation. Fixed housing header (wordmark, document title,
// live locality proof, split toggle, trust report). The ingest screen is the
// instrument at rest; on load, the document is readable immediately at Expert
// while the other levels develop and the dial's detents light up. No blocking
// wait.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Reader from "./components/Reader";
import TrustReport from "./components/TrustReport";
import { onOutgoingChange, outgoingRequests } from "./networkProof";
import { SAMPLES } from "./samples";

type Phase = "ingest" | "generating" | "ready";

const ACCEPTED = [".txt", ".md", ".markdown"];

export default function App() {
  const [phase, setPhase] = useState<Phase>("ingest");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [outgoing, setOutgoing] = useState(outgoingRequests());
  const fileInput = useRef<HTMLInputElement>(null);
  const genT0 = useRef<number | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);

  useEffect(() => onOutgoingChange(setOutgoing), []);

  async function handleIngest() {
    if (!text.trim()) return;
    const t = title.trim() || firstLine(text);
    setTitle(t);
    genT0.current = Date.now();
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

  useEffect(() => {
    if (phase !== "generating" || !docId) return;
    const tick = async () => {
      const s = await api.status(docId);
      setProgressPct(Math.round(s.progress * 100));
      if (s.progress >= 1) {
        if (genT0.current) setDurationS((Date.now() - genT0.current) / 1000);
        setPhase("ready");
      }
    };
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [phase, docId]);

  const reading = phase === "generating" || phase === "ready";

  return (
    <div>
      <header className="header">
        <div className="wordmark" aria-label="Dial">
          <span className="lozenge" aria-hidden /> DIAL
        </div>
        {reading && <div className="doc-name">{title}</div>}
        <div className="header-actions">
          <span
            className={`pill-local ${outgoing > 0 ? "breached" : ""}`}
            title="Live count of network requests leaving this machine"
          >
            <span className="dot" /> local · {outgoing} outgoing
          </span>
          {reading && docId && (
            <>
              <button onClick={() => setSplit((v) => !v)} aria-pressed={split}>
                {split ? "Single view" : "Split view"}
              </button>
              <button onClick={() => setReportOpen(true)}>Trust report</button>
            </>
          )}
        </div>
      </header>

      {phase === "generating" && (
        <div className="gen-progress" aria-label="generation progress">
          <div className="bar" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <main className="main">
        {phase === "ingest" && (
          <section className="ingest">
            <div
              className={`ingest-frame ${dragging ? "dragover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className="ingest-lead">
                Every document has a depth of field. Set yours.
              </div>
              <textarea
                placeholder="Paste your document…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Document text"
              />
              <div className="ingest-actions">
                <button className="primary" onClick={handleIngest} disabled={!text.trim()}>
                  Read with Dial
                </button>
                <button onClick={() => fileInput.current?.click()}>Open a file</button>
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
              </div>
              {dragging && (
                <div className="drop-hint" aria-hidden>
                  Drop to load
                </div>
              )}
            </div>

            {fileError && <div className="file-error">{fileError}</div>}

            <div className="sample-tabs">
              {SAMPLES.map((s) => (
                <button
                  key={s.key}
                  className="sample-tab"
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

        {reading && docId && (
          <Reader
            docId={docId}
            developing={phase === "generating"}
            split={split}
            initialLevel="expert"
          />
        )}
      </main>

      {reportOpen && docId && (
        <TrustReport
          docId={docId}
          title={title}
          durationS={durationS}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

function firstLine(t: string): string {
  const line = t.trim().split("\n")[0].replace(/^#{1,6}\s+/, "").trim();
  return line.slice(0, 80) || "Untitled";
}
