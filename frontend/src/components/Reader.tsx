// Reader view (SPEC §7) — the demo heart.
//
// - All four levels are prefetched into a client cache once generation is done,
//   so dial changes and scrubbing are zero-latency swaps (§3.3 made visible).
// - Sealed chips are FLIP-animated across level changes: the prose dissolves
//   and rewrites itself, but the facts physically glide to their new position,
//   unchanged. The trust contract, visible to the naked eye.
// - Photo-develop mode (§3.3): while the backend generates, pending paragraphs
//   render as a sepia ghost of the original and "develop" into their rewrite
//   as each one lands, the audit check popping in after.
// - Reading-time meter: the Impact story in one glance (4 min → 1 min 30).

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, LEVELS, type DocResponse, type Level, type ParagraphOut } from "../api";
import {
  displayHtml,
  formatReadingTime,
  isHeading,
  lessDetail,
  moreDetail,
  readingSeconds,
} from "../text";
import Dial from "./Dial";
import Paragraph from "./Paragraph";
import SplitView from "./SplitView";

const CASCADE_STEP_MS = 30;
const FADE_OUT_MS = 90; // short: the swap itself is instant, the fade is a beat
const FOCUS_MS = 1000;
const FLIP_MS = 450;
const DEVELOP_POLL_MS = 1500;

// Chromatic identity per level: graphite → forest → amber → slate. Set on the
// document root so the masthead dot, tuner needle and ribbon all follow the dial.
const LEVEL_ACCENT: Record<Level, string> = {
  expert: "#4a4238",
  standard: "#3a5a40",
  plain: "#b07d3f",
  simple: "#46708f",
};

type ChipSnap = { key: string; text: string; rect: DOMRect };

function snapshotChips(root: HTMLElement | null): ChipSnap[] {
  if (!root) return [];
  const counts: Record<string, number> = {};
  return Array.from(root.querySelectorAll<HTMLElement>(".seal[data-seal-id]")).map(
    (el) => {
      const id = el.dataset.sealId!;
      counts[id] = (counts[id] ?? 0) + 1;
      return {
        key: `${id}#${counts[id]}`,
        text: el.textContent ?? "",
        rect: el.getBoundingClientRect(),
      };
    }
  );
}

// Imperative overlay: clone chips at their old positions, glide them to the new
// ones, remove. The real chips hide underneath (.chips-flying) meanwhile.
function flyChips(root: HTMLElement, before: ChipSnap[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const after = snapshotChips(root);
  if (!before.length || !after.length) return;
  const target = new Map(after.map((c) => [c.key, c]));

  const layer = document.createElement("div");
  layer.className = "fly-layer";
  document.body.appendChild(layer);
  root.classList.add("chips-flying");

  for (const old of before) {
    const to = target.get(old.key);
    const el = document.createElement("span");
    el.className = "seal seal-flyer";
    el.textContent = old.text;
    el.style.left = `${old.rect.left}px`;
    el.style.top = `${old.rect.top}px`;
    layer.appendChild(el);
    requestAnimationFrame(() => {
      if (to) {
        el.style.transform = `translate(${to.rect.left - old.rect.left}px, ${
          to.rect.top - old.rect.top
        }px)`;
      } else {
        el.style.opacity = "0";
      }
    });
  }
  window.setTimeout(() => {
    layer.remove();
    root.classList.remove("chips-flying");
  }, FLIP_MS + 60);
}

export default function Reader({
  docId,
  developing = false,
  initialLevel = "expert",
}: {
  docId: string;
  developing?: boolean;
  initialLevel?: Level;
}) {
  const [level, setLevel] = useState<Level>(initialLevel);
  const [docs, setDocs] = useState<Partial<Record<Level, DocResponse>>>({});
  const [morphing, setMorphing] = useState(false);
  const [split, setSplit] = useState(false);

  // semantic zoom (Tier 3) — unchanged
  const [overrides, setOverrides] = useState<Record<number, Level>>({});
  const [parCache, setParCache] = useState<Record<string, ParagraphOut>>({});
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const focusTimer = useRef<number | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFlip = useRef<ChipSnap[] | null>(null);
  const morphTimer = useRef<number | null>(null);

  const doc = docs[level];

  const load = useCallback(
    async (lvl: Level) => {
      const d = await api.doc(docId, lvl);
      setDocs((prev) => ({ ...prev, [lvl]: d }));
    },
    [docId]
  );

  useEffect(() => {
    if (!docs[level]) load(level);
  }, [level, docs, load]);

  // Chromatic ambiance follows the dial (and resets on unmount).
  useEffect(() => {
    document.documentElement.style.setProperty("--level-accent", LEVEL_ACCENT[level]);
    return () => {
      document.documentElement.style.removeProperty("--level-accent");
    };
  }, [level]);

  // Photo-develop: poll the current level while the backend generates; each
  // poll swaps ghost paragraphs for freshly developed ones.
  useEffect(() => {
    if (!developing) return;
    const t = window.setInterval(() => load(level), DEVELOP_POLL_MS);
    return () => window.clearInterval(t);
  }, [developing, level, load]);

  // Once generation completes, prefetch every level → the dial becomes a
  // zero-latency scrubber over the SQLite cache.
  useEffect(() => {
    if (developing) return;
    load(level); // refresh once more so the last pending paragraphs resolve
    for (const l of LEVELS) {
      if (!docs[l]) load(l);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [developing, docId]);

  const changeLevel = useCallback(
    (lvl: Level) => {
      if (lvl === level) return;
      // FLIP: capture chip positions while the old DOM is still up. During a
      // rapid scrub, keep the earliest snapshot so chips fly one clean arc.
      if (!pendingFlip.current) {
        pendingFlip.current = snapshotChips(rootRef.current);
      }
      setOverrides({});
      setFocusedId(null);
      setMorphing(true);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
      morphTimer.current = window.setTimeout(() => {
        setLevel(lvl);
        setMorphing(false);
      }, FADE_OUT_MS);
    },
    [level]
  );

  // After the new level paints, launch the chip flight. Typography snaps
  // (no font-size transition) during the flight so the measured landing
  // positions are final — the cascade fade masks the snap.
  useLayoutEffect(() => {
    if (!morphing && pendingFlip.current && rootRef.current) {
      const root = rootRef.current;
      const before = pendingFlip.current;
      pendingFlip.current = null;
      root.classList.add("type-snap");
      void root.offsetWidth; // reflow: typography lands before we measure
      flyChips(root, before);
      window.setTimeout(() => root.classList.remove("type-snap"), FLIP_MS + 80);
    }
  }, [level, morphing]);

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
        if (!parCache[key]) {
          api.paragraph(docId, parId, next).then((p) =>
            setParCache((c) => ({ ...c, [key]: p }))
          );
        }
      }
    },
    [docId, level, parCache, focus]
  );

  if (split) {
    return <SplitView docId={docId} onExit={() => setSplit(false)} />;
  }

  if (!doc) return <div className="progress-label">Loading…</div>;

  const expertDoc = docs.expert;
  const seconds = readingSeconds(doc.paragraphs);
  const expertSeconds = expertDoc ? readingSeconds(expertDoc.paragraphs) : null;
  const delta =
    expertSeconds && expertSeconds > 0 && level !== "expert"
      ? Math.round((1 - seconds / expertSeconds) * 100)
      : null;

  // first body paragraph gets the editorial drop cap
  const firstBodyId = doc.paragraphs.find((p) => !isHeading(p.html))?.id;

  return (
    <div ref={rootRef} className="reader" data-level={level}>
      <div className="level-ribbon" aria-hidden />
      <div className="toolbar">
        <Dial level={level} onChange={changeLevel} />
        <div className="toolbar-side">
          <div className="read-meter" aria-label="estimated reading time">
            <span className="read-time">⏱ {formatReadingTime(seconds)}</span>
            {delta !== null && delta > 0 && (
              <span className="read-delta">−{delta}%</span>
            )}
          </div>
          <button className="split-toggle" onClick={() => setSplit(true)}>
            ⇋ Split view
          </button>
        </div>
      </div>
      {developing && (
        <div className="develop-note">
          <span className="develop-dot" /> generating locally — the document is
          developing…
        </div>
      )}
      <h1 className="doc-title">{doc.title}</h1>
      {doc.paragraphs.map((p, i) => {
        const heading = isHeading(p.html);
        const ov = overrides[p.id];
        const effLevel = ov ?? level;
        const data = ov ? parCache[`${p.id}:${ov}`] ?? p : p;
        return (
          <Paragraph
            key={p.id}
            par={{ ...data, html: displayHtml(data.html) }}
            invariants={doc.invariants}
            isHeading={heading}
            lede={p.id === firstBodyId}
            morphing={morphing}
            delayMs={morphing ? 0 : i * CASCADE_STEP_MS}
            zoomable={!developing}
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
