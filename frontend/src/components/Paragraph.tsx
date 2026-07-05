// One paragraph. The text is king; affordances live in the left gutter and
// appear on hover. Sealed facts render as brass plates. Flagged passages carry
// a permanent left border and, on hover, a hand-drawn margin gloss with the
// auditor's reason (a brace that draws itself, then the italic note) plus an
// inline "see original" comparison. Depth-of-field blur (set by the Reader
// during semantic zoom) is applied inline.

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
  originalHtml?: string;
  hideAudit?: boolean;
  blurPx?: number; // depth-of-field blur when another paragraph is focused
  zoomable?: boolean;
  overridden?: boolean;
  effectiveLevel?: Level;
  onMore?: () => void;
  onLess?: () => void;
}

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
  blurPx = 0,
  zoomable = false,
  overridden = false,
  effectiveLevel,
  onMore,
  onLess,
}: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [showOriginal, setShowOriginal] = useState(false);

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
    blurPx > 0 ? "dof" : "",
    overridden ? "zoomed" : "",
    !isHeading && audit === "faithful" ? "faithful" : "",
    !isHeading && audit === "pending" ? "developing" : "",
    !isHeading && audit === "uncertain" ? "uncertain" : "",
    !isHeading && audit === "failed" ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p
      ref={ref}
      className={cls}
      style={{ transitionDelay: `${delayMs}ms`, filter: blurPx ? `blur(${blurPx}px)` : undefined }}
    >
      {!isHeading && (
        <span className="gutter" contentEditable={false}>
          {overridden && effectiveLevel && (
            <span className="zoom-tag">{LEVEL_LABEL[effectiveLevel].toUpperCase()}</span>
          )}
          {audit && <AuditBadge verdict={audit} />}
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
      {flagged && par.audit_note && (
        <span className={`gloss ${audit}`} contentEditable={false}>
          <svg className="gloss-brace" viewBox="0 0 12 22" aria-hidden focusable="false">
            <path d="M9,1 Q3,1 3,6 Q3,11 1,11 Q3,11 3,16 Q3,21 9,21" />
          </svg>
          <span className="gloss-text">{par.audit_note}</span>
        </span>
      )}
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
