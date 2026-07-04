// Split "two readers" view (SPEC §1.1 / §7): the same document side-by-side at
// two different levels, each column with its own dial, scroll-synced so the two
// readings stay aligned. The pitch's parent/teen moment.

import { useRef, useState, type RefObject } from "react";
import type { Level } from "../api";
import { useDoc } from "../hooks";
import { displayHtml, isHeading } from "../text";
import Dial from "./Dial";
import Paragraph from "./Paragraph";

export default function SplitView({
  docId,
  onExit,
}: {
  docId: string;
  onExit: () => void;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Proportional scroll sync between the two columns (paragraph-aligned in
  // practice since both render the same paragraphs at the same order).
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    const max = from.scrollHeight - from.clientHeight;
    const ratio = max > 0 ? from.scrollTop / max : 0;
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <div className="split">
      <div className="split-header">
        <h1 className="doc-title">Two readers</h1>
        <button className="split-toggle" onClick={onExit}>
          ✕ Exit split
        </button>
      </div>
      <div className="split-cols">
        <Column
          docId={docId}
          initial="expert"
          scrollRef={leftRef}
          onScroll={() => sync(leftRef.current, rightRef.current)}
        />
        <Column
          docId={docId}
          initial="simple"
          scrollRef={rightRef}
          onScroll={() => sync(rightRef.current, leftRef.current)}
        />
      </div>
    </div>
  );
}

function Column({
  docId,
  initial,
  scrollRef,
  onScroll,
}: {
  docId: string;
  initial: Level;
  scrollRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
}) {
  const [level, setLevel] = useState(initial);
  const doc = useDoc(docId, level);
  return (
    <div className="split-col">
      <Dial level={level} onChange={setLevel} />
      <div className="split-scroll" ref={scrollRef} onScroll={onScroll}>
        {doc ? (
          doc.paragraphs.map((p) => (
            <Paragraph
              key={p.id}
              par={{ ...p, html: displayHtml(p.html) }}
              invariants={doc.invariants}
              isHeading={isHeading(p.html)}
              morphing={false}
              delayMs={0}
            />
          ))
        ) : (
          <div className="progress-label">Loading…</div>
        )}
      </div>
    </div>
  );
}
