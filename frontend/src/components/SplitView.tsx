// Split view — the same document at two levels, 50/50, 1px divider. Each
// column has its own mini horizontal dial. Scroll is synchronized by paragraph
// id: the paragraph at the top of one viewport aligns its twin in the other.
// Audit states show only on the more simplified column (doubt belongs to the
// rewrite, not the source).

import { useRef, useState } from "react";
import { LEVELS, type Level } from "../api";
import { useDoc } from "../hooks";
import { displayHtml, isHeading } from "../text";
import Dial from "./Dial";
import Paragraph from "./Paragraph";

export default function SplitView({ docId }: { docId: string }) {
  const [levels, setLevels] = useState<[Level, Level]>(["expert", "simple"]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // audit shows only on the column with the more simplified level
  const simplerSide = LEVELS.indexOf(levels[0]) >= LEVELS.indexOf(levels[1]) ? 0 : 1;

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    const fromRect = from.getBoundingClientRect();
    const wrappers = Array.from(from.querySelectorAll<HTMLElement>("[data-par-id]"));
    const cur = wrappers.find(
      (w) => w.getBoundingClientRect().bottom > fromRect.top + 4
    );
    if (cur) {
      const id = cur.dataset.parId!;
      const twin = to.querySelector<HTMLElement>(`[data-par-id="${id}"]`);
      if (twin) {
        const curOffset = cur.getBoundingClientRect().top - fromRect.top;
        const toRect = to.getBoundingClientRect();
        const twinOffset = twin.getBoundingClientRect().top - toRect.top;
        to.scrollTop += twinOffset - curOffset;
      }
    }
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <div className="split">
      <div className="split-cols">
        {([0, 1] as const).map((side) => (
          <Column
            key={side}
            docId={docId}
            level={levels[side]}
            onLevel={(l) =>
              setLevels((prev) => (side === 0 ? [l, prev[1]] : [prev[0], l]))
            }
            hideAudit={side !== simplerSide}
            scrollRef={side === 0 ? leftRef : rightRef}
            onScroll={() =>
              side === 0
                ? sync(leftRef.current, rightRef.current)
                : sync(rightRef.current, leftRef.current)
            }
          />
        ))}
      </div>
    </div>
  );
}

function Column({
  docId,
  level,
  onLevel,
  hideAudit,
  scrollRef,
  onScroll,
}: {
  docId: string;
  level: Level;
  onLevel: (l: Level) => void;
  hideAudit: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}) {
  const doc = useDoc(docId, level);
  return (
    <div className="split-col">
      <Dial level={level} onChange={onLevel} />
      <div className="split-scroll" ref={scrollRef} onScroll={onScroll}>
        {doc &&
          doc.paragraphs.map((p) => (
            <div key={p.id} data-par-id={p.id}>
              <Paragraph
                par={{ ...p, html: displayHtml(p.html) }}
                invariants={doc.invariants}
                isHeading={isHeading(p.html)}
                morphing={false}
                delayMs={0}
                hideAudit={hideAudit}
              />
            </div>
          ))}
      </div>
    </div>
  );
}
