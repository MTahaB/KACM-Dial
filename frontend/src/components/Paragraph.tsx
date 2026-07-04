// One paragraph of the document (SPEC §7). Renders `html` — which contains
// <seal id="..">…</seal> spans in Tier 2 — resolving those to SealedChip. Carries
// the cascade-morph class, the audit state, and (Tier 3) the semantic-zoom
// affordance: per-paragraph +/− controls on hover and ctrl+scroll.

import { useEffect, useRef } from "react";
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
  // Tier 3 semantic zoom (optional — omitted in split-view columns).
  zoomable?: boolean;
  overridden?: boolean; // true when this paragraph is at a non-global level
  effectiveLevel?: Level;
  dimmed?: boolean;
  onMore?: () => void; // more detail (toward expert)
  onLess?: () => void; // less detail (toward simple)
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
    parts.push(<SealedChip key={`s${key++}`} text={text} />);
    last = re.lastIndex;
  }
  if (last < html.length) parts.push(html.slice(last));
  return parts.length ? parts : [html];
}

export default function Paragraph({
  par,
  invariants,
  isHeading,
  morphing,
  delayMs,
  zoomable = false,
  overridden = false,
  effectiveLevel,
  dimmed = false,
  onMore,
  onLess,
}: Props) {
  const ref = useRef<HTMLParagraphElement>(null);

  // ctrl + wheel over the paragraph = zoom detail in/out. Native listener with
  // passive:false so we can preventDefault the browser's page zoom.
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

  const cls = [
    "paragraph",
    isHeading ? "heading" : "",
    morphing ? "morphing" : "",
    dimmed ? "dimmed" : "",
    overridden ? "zoomed" : "",
    !isHeading && par.audit === "uncertain" ? "uncertain" : "",
    !isHeading && par.audit === "failed" ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const showZoom = zoomable && !isHeading;

  return (
    <p ref={ref} className={cls} style={{ transitionDelay: `${delayMs}ms` }}>
      {renderHtml(par.html, invariants)}
      {!isHeading && <AuditBadge verdict={par.audit} note={par.audit_note} />}
      {overridden && effectiveLevel && (
        <span className="zoom-tag">{LEVEL_LABEL[effectiveLevel]}</span>
      )}
      {showZoom && (
        <span className="zoom-ctl" contentEditable={false}>
          <button title="More detail (ctrl+scroll up)" onClick={onMore} aria-label="more detail">
            ＋
          </button>
          <button title="Less detail (ctrl+scroll down)" onClick={onLess} aria-label="less detail">
            －
          </button>
        </span>
      )}
    </p>
  );
}
