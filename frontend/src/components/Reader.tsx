// Reader view — the document is a paper print centered on the camera body; the
// aperture dial is anchored right. All four levels are prefetched so dial moves
// are zero-latency swaps. Sealed plates FLIP across level changes and pulse as
// the text reworks around them. Semantic zoom "pulls focus": the chosen
// paragraph stays sharp while the others blur by distance (depth of field).

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
import ApertureDial from "./ApertureDial";
import IrisLoader from "./IrisLoader";
import Paragraph from "./Paragraph";
import SplitView from "./SplitView";

const CASCADE_STEP_MS = 30;
const FADE_OUT_MS = 90;
const FLIP_MS = 450;
const DEVELOP_POLL_MS = 2000;

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

function flyChips(root: HTMLElement, before: ChipSnap[]) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const after = snapshotChips(root);
  const target = new Map(after.map((c) => [c.key, c]));

  if (!reduce && before.length && after.length) {
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
      pulseSeals(root);
    }, FLIP_MS + 60);
  } else {
    pulseSeals(root);
  }
}

// the plates vibrate once as the material settles around them
function pulseSeals(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".seal").forEach((el) => {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
    window.setTimeout(() => el.classList.remove("pulse"), 200);
  });
}

function isComplete(d: DocResponse | undefined): boolean {
  return !!d && d.paragraphs.every((p) => p.audit !== "pending");
}

export default function Reader({
  docId,
  developing = false,
  split = false,
  initialLevel = "expert",
}: {
  docId: string;
  developing?: boolean;
  split?: boolean;
  initialLevel?: Level;
}) {
  const [level, setLevel] = useState<Level>(initialLevel);
  const [docs, setDocs] = useState<Partial<Record<Level, DocResponse>>>({});
  const [morphing, setMorphing] = useState(false);

  const [overrides, setOverrides] = useState<Record<number, Level>>({});
  const [parCache, setParCache] = useState<Record<string, ParagraphOut>>({});
  const [focusedId, setFocusedId] = useState<number | null>(null);

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

  useEffect(() => {
    if (!developing) return;
    const tick = () => {
      for (const l of LEVELS) load(l);
    };
    tick();
    const t = window.setInterval(tick, DEVELOP_POLL_MS);
    return () => window.clearInterval(t);
  }, [developing, load]);

  useEffect(() => {
    if (developing) return;
    for (const l of LEVELS) load(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [developing, docId]);

  const changeLevel = useCallback(
    (lvl: Level) => {
      if (lvl === level) return;
      if (!pendingFlip.current) {
        pendingFlip.current = snapshotChips(rootRef.current);
      }
      setOverrides({});
      setFocusedId(null); // dial reset clears every local zoom + the depth of field
      setMorphing(true);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
      morphTimer.current = window.setTimeout(() => {
        setLevel(lvl);
        setMorphing(false);
      }, FADE_OUT_MS);
    },
    [level]
  );

  useLayoutEffect(() => {
    if (!morphing && pendingFlip.current && rootRef.current) {
      const before = pendingFlip.current;
      pendingFlip.current = null;
      flyChips(rootRef.current, before);
    }
  }, [level, morphing]);

  const zoom = useCallback(
    (parId: number, next: Level) => {
      setOverrides((prev) => {
        const copy = { ...prev };
        if (next === level) delete copy[parId];
        else copy[parId] = next;
        setFocusedId(Object.keys(copy).length ? parId : null);
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
    [docId, level, parCache]
  );

  if (split) {
    return <SplitView docId={docId} />;
  }

  if (!doc) return null;

  const complete = Object.fromEntries(
    LEVELS.map((l) => [l, l === "expert" ? true : isComplete(docs[l])])
  ) as Record<Level, boolean>;

  const expertById = new Map(
    (docs.expert?.paragraphs ?? []).map((p) => [p.id, p.html])
  );

  const meter = `~${formatReadingTime(readingSeconds(doc.paragraphs))}`;
  const focusedIndex =
    focusedId === null ? -1 : doc.paragraphs.findIndex((p) => p.id === focusedId);

  return (
    <div ref={rootRef} className="reader">
      <ApertureDial level={level} onChange={changeLevel} complete={complete} meter={meter} />
      <div className="sheet">
        {developing && (
          <div className="develop-note">
            <IrisLoader /> generating locally — levels light up on the dial as
            they complete
          </div>
        )}
        <h1 className="doc-title">{doc.title}</h1>
        {doc.paragraphs.map((p, i) => {
          const heading = isHeading(p.html);
          const ov = overrides[p.id];
          const effLevel = ov ?? level;
          const data = ov ? parCache[`${p.id}:${ov}`] ?? p : p;
          const blurPx =
            focusedIndex >= 0 && i !== focusedIndex
              ? Math.min(4, Math.abs(i - focusedIndex))
              : 0;
          return (
            <Paragraph
              key={p.id}
              par={{ ...data, html: displayHtml(data.html) }}
              invariants={doc.invariants}
              isHeading={heading}
              morphing={morphing}
              delayMs={morphing ? 0 : i * CASCADE_STEP_MS}
              originalHtml={displayHtml(expertById.get(p.id) ?? "")}
              blurPx={blurPx}
              zoomable={!developing}
              overridden={!!ov}
              effectiveLevel={effLevel}
              onMore={() => zoom(p.id, moreDetail(effLevel))}
              onLess={() => zoom(p.id, lessDetail(effLevel))}
            />
          );
        })}
        <MetricsFooter docId={docId} />
      </div>
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
        <b>{m.tokens_per_s_avg}</b> tokens/s
      </span>
      <span>
        <b>{m.n_rewrites}</b> rewrites
      </span>
    </div>
  );
}
