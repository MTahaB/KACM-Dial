// Reader view (SPEC §7): the document, the dial, the cascade morph, and (Tier 3)
// per-paragraph semantic zoom. Turning the dial morphs the whole document; zooming
// a single paragraph raises ITS level of detail while the rest stays put, like
// pulling one map tile to a finer zoom.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocResponse, type Level, type ParagraphOut } from "../api";
import { displayHtml, isHeading, lessDetail, moreDetail } from "../text";
import Dial from "./Dial";
import Paragraph from "./Paragraph";
import SplitView from "./SplitView";

const CASCADE_STEP_MS = 30; // per-paragraph stagger
const FADE_OUT_MS = 220; // must match .paragraph transition in styles.css
const FOCUS_MS = 1000; // "focus" dim duration when a paragraph is zoomed

export default function Reader({ docId }: { docId: string }) {
  const [level, setLevel] = useState<Level>("expert");
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [morphing, setMorphing] = useState(false);
  const [split, setSplit] = useState(false);

  // Semantic zoom: per-paragraph level overrides + a cache of fetched paragraphs.
  const [overrides, setOverrides] = useState<Record<number, Level>>({});
  const [cache, setCache] = useState<Record<string, ParagraphOut>>({});
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const focusTimer = useRef<number | null>(null);

  const load = useCallback(
    async (lvl: Level) => setDoc(await api.doc(docId, lvl)),
    [docId]
  );

  useEffect(() => {
    load("expert");
  }, [load]);

  const changeLevel = useCallback(
    (lvl: Level) => {
      if (lvl === level) return;
      setLevel(lvl);
      setOverrides({}); // dial morphs the whole doc → drop per-paragraph zooms
      setFocusedId(null);
      setMorphing(true);
      window.setTimeout(async () => {
        await load(lvl);
        setMorphing(false);
      }, FADE_OUT_MS);
    },
    [level, load]
  );

  const focus = useCallback((id: number) => {
    setFocusedId(id);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFocusedId(null), FOCUS_MS);
  }, []);

  const zoom = useCallback(
    (parId: number, next: Level) => {
      focus(parId);
      setOverrides((prev) => {
        const copy = { ...prev };
        if (next === level) delete copy[parId];
        else copy[parId] = next;
        return copy;
      });
      if (next !== level) {
        const key = `${parId}:${next}`;
        if (!cache[key]) {
          api.paragraph(docId, parId, next).then((p) =>
            setCache((c) => ({ ...c, [key]: p }))
          );
        }
      }
    },
    [docId, level, cache, focus]
  );

  if (split) {
    return <SplitView docId={docId} onExit={() => setSplit(false)} />;
  }

  if (!doc) return <div className="progress-label">Loading…</div>;

  return (
    <div>
      <div className="toolbar">
        <Dial level={level} onChange={changeLevel} />
        <button className="split-toggle" onClick={() => setSplit(true)}>
          ⇋ Split view
        </button>
      </div>
      <h1 className="doc-title">{doc.title}</h1>
      {doc.paragraphs.map((p, i) => {
        const heading = isHeading(p.html);
        const ov = overrides[p.id];
        const effLevel = ov ?? level;
        const data = ov ? cache[`${p.id}:${ov}`] ?? p : p;
        return (
          <Paragraph
            key={p.id}
            par={{ ...data, html: displayHtml(data.html) }}
            invariants={doc.invariants}
            isHeading={heading}
            morphing={morphing}
            delayMs={morphing ? 0 : i * CASCADE_STEP_MS}
            zoomable
            overridden={!!ov}
            effectiveLevel={effLevel}
            dimmed={focusedId !== null && focusedId !== p.id}
            onMore={() => zoom(p.id, moreDetail(effLevel))}
            onLess={() => zoom(p.id, lessDetail(effLevel))}
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
      {m.n_uncertain > 0 && (
        <span>
          <b>{m.n_uncertain}</b> flagged
        </span>
      )}
    </div>
  );
}
