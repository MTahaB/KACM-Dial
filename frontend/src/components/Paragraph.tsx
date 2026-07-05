// One paragraph of the document. The text is king; all affordances live in the
// left gutter (audit state, semantic-zoom controls, per-paragraph level tag)
// and appear on hover. Flagged passages offer an inline "see original"
// comparison — never a modal.

import { useEffect, useRef, useState } from "react";
import type { Invariant, Level, ParagraphOut } from "../api";
import { LEVEL_LABEL } from "../text";
import AuditBadge from "./AuditBadge";
import SealedChip from "./SealedChip";

interface Props {
  par: ParagraphOut;
  invariants: Invariant[];
  isHeading: boolean;
  morphing: boolean;
  delayMs: number;
  originalHtml?: string; // expert text, for the inline comparison on flagged passages
  hideAudit?: boolean; // split view: audit shows only on the more simplified column
  zoomable?: boolean;
  overridden?: boolean;
  effectiveLevel?: Level;
  dimmed?: boolean;
  onMore?: () => void;
  onLess?: () => void;
}

// Split html on <seal>…</seal> markup and interleave SealedChip components.
function renderHtml(html: string, invariants: Invariant[]) {
  const byId = new Map(invariants.map((i) => [i.id, i.text]));
  const parts: Array<string | JSX.Element> = [];
  const re = /<seal\s+id="([^"]+)"\s*\/?>(?:([^<]*)<\/seal>)?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) parts.push(html.slice(last, m.index));
    const text = m[2] || byId.get(m[1]) || m[1];
    parts.push(<SealedChip key={`s${key++}`} text={text} sealId={m[1]} />);
    last = re.lastIndex;
  }
  if (last < html.length) parts.push(html.slice(last));
  return parts.length ? parts : [html];
}

function stripSeals(html: string): string {
  return html.replace(/<seal\s+id="[^"]+"\s*\/?>([^<]*)<\/seal>/g, "$1");
}

export default function Paragraph({
  par,
  invariants,
  isHeading,
  morphing,
  delayMs,
  originalHtml,
  hideAudit = false,
  zoomable = false,
  overridden = false,
  effectiveLevel,
  dimmed = false,
  onMore,
  onLess,
}: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // ctrl+wheel over the paragraph = semantic zoom in/out
  useEffect(() => {
    const el = ref.current;
    if (!el || !zoomable || isHeading) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) onMore?.();
      else onLess?.();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, isHeading, onMore, onLess]);

  const audit = hideAudit ? null : par.audit;
  const flagged = audit === "uncertain" || audit === "failed";

  const cls = [
    "paragraph",
    isHeading ? "heading" : "",
    morphing ? "morphing" : "",
    dimmed ? "dimmed" : "",
    overridden ? "zoomed" : "",
    !isHeading && audit === "pending" ? "developing" : "",
    !isHeading && audit === "uncertain" ? "uncertain" : "",
    !isHeading && audit === "failed" ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p ref={ref} className={cls} style={{ transitionDelay: `${delayMs}ms` }}>
      {!isHeading && (
        <span className="gutter" contentEditable={false}>
          {overridden && effectiveLevel && (
            <span className="zoom-tag">{LEVEL_LABEL[effectiveLevel]}</span>
          )}
          {audit && <AuditBadge verdict={audit} note={par.audit_note} />}
          {zoomable && (
            <span className="zoom-ctl">
              <button title="More detail (ctrl+scroll up)" onClick={onMore} aria-label="more detail">
                +
              </button>
              <button title="Less detail (ctrl+scroll down)" onClick={onLess} aria-label="less detail">
                −
              </button>
            </span>
          )}
        </span>
      )}
      {renderHtml(par.html, invariants)}
      {flagged && originalHtml && (
        <>
          <button className="link see-original" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? "hide original" : "see original"}
          </button>
          {showOriginal && (
            <span className="original-inline">
              <span className="label">Original — Expert</span>
              {stripSeals(originalHtml)}
            </span>
          )}
        </>
      )}
    </p>
  );
}
