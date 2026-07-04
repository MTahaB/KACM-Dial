// One paragraph of the document (SPEC §7). Renders `html` — which in Tier 2 will
// contain <seal id="..">…</seal> spans — resolving those to SealedChip. Carries
// the cascade-morph class and the audit state styling/badge.

import type { Invariant, ParagraphOut } from "../api";
import AuditBadge from "./AuditBadge";
import SealedChip from "./SealedChip";

interface Props {
  par: ParagraphOut;
  invariants: Invariant[];
  isHeading: boolean;
  morphing: boolean;
  delayMs: number;
}

// Split html on <seal>…</seal> markup and interleave SealedChip components.
// Backend emits either <seal id="inv0">TEXT</seal> or a bare token; we handle the
// common tag form and fall back to raw text otherwise.
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

export default function Paragraph({ par, invariants, isHeading, morphing, delayMs }: Props) {
  const cls = [
    "paragraph",
    isHeading ? "heading" : "",
    morphing ? "morphing" : "",
    !isHeading && par.audit === "uncertain" ? "uncertain" : "",
    !isHeading && par.audit === "failed" ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p className={cls} style={{ transitionDelay: `${delayMs}ms` }}>
      {renderHtml(par.html, invariants)}
      {!isHeading && <AuditBadge verdict={par.audit} note={par.audit_note} />}
    </p>
  );
}
