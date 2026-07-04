// Reader view (SPEC §7): the document, the dial, and the signature cascade morph.
// On a level change every paragraph fades+blurs out, the new level is fetched
// from cache (instant — pre-generated per §3.3), then paragraphs fade back in on
// a staggered 30ms top-to-bottom cascade. That cascade IS the signature visual.

import { useCallback, useEffect, useState } from "react";
import { api, type DocResponse, type Level } from "../api";
import Dial from "./Dial";
import Paragraph from "./Paragraph";

const CASCADE_STEP_MS = 30; // per-paragraph stagger
const FADE_OUT_MS = 220; // must match .paragraph transition in styles.css

// The API contract (§4) does not carry an is_heading flag, so infer it on the
// client the same way the backend chunker does (leading #, short ALL-CAPS).
function isHeading(html: string): boolean {
  const s = html.trim();
  if (!s || s.includes("\n")) return false;
  if (s.startsWith("#")) return true;
  const letters = [...s].filter((c) => /\p{L}/u.test(c));
  return letters.length > 0 && s.length < 80 && s === s.toUpperCase();
}

function displayHtml(html: string): string {
  return html.replace(/^#{1,6}\s+/, "");
}

export default function Reader({ docId }: { docId: string }) {
  const [level, setLevel] = useState<Level>("expert");
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [morphing, setMorphing] = useState(false);

  const load = useCallback(
    async (lvl: Level) => {
      const d = await api.doc(docId, lvl);
      setDoc(d);
    },
    [docId]
  );

  useEffect(() => {
    load("expert");
  }, [load]);

  const changeLevel = useCallback(
    (lvl: Level) => {
      if (lvl === level) return;
      setLevel(lvl);
      setMorphing(true); // fade current paragraphs out
      window.setTimeout(async () => {
        await load(lvl);
        setMorphing(false); // staggered fade-in via per-paragraph transitionDelay
      }, FADE_OUT_MS);
    },
    [level, load]
  );

  if (!doc) {
    return <div className="progress-label">Loading…</div>;
  }

  return (
    <div>
      <Dial level={level} onChange={changeLevel} />
      <h1 className="doc-title">{doc.title}</h1>
      {doc.paragraphs.map((p, i) => {
        const heading = isHeading(p.html);
        return (
          <Paragraph
            key={p.id}
            par={{ ...p, html: displayHtml(p.html) }}
            invariants={doc.invariants}
            isHeading={heading}
            morphing={morphing}
            delayMs={morphing ? 0 : i * CASCADE_STEP_MS}
          />
        );
      })}
      <MetricsFooter docId={docId} />
    </div>
  );
}

function MetricsFooter({ docId }: { docId: string }) {
  const [m, setM] = useState<Awaited<ReturnType<typeof api.metrics>> | null>(null);
  useEffect(() => {
    api.metrics(docId).then(setM).catch(() => {});
  }, [docId]);
  if (!m) return null;
  return (
    <div className="metrics">
      <span>
        Writer <b>{m.model_writer}</b>
      </span>
      <span>
        Auditor <b>{m.model_auditor}</b>
      </span>
      <span>
        <b>{m.tokens_per_s_avg}</b> tok/s
      </span>
      <span>
        <b>{m.n_rewrites}</b> rewrites
      </span>
    </div>
  );
}
