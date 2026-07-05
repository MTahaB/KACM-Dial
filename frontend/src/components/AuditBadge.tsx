// Audit indicator in the paragraph gutter. Trust is silent by default: the
// faithful check shows on paragraph hover only. Doubt is never silent: the
// uncertain / violation mark stays visible (the reason is drawn as a margin
// gloss in the paragraph body, see Paragraph.tsx). No tooltips, no modals.

import type { AuditVerdict } from "../api";

export default function AuditBadge({ verdict }: { verdict: AuditVerdict }) {
  if (verdict === "pending") return null;

  if (verdict === "faithful") {
    return (
      <span className="gutter-check" aria-label="fidelity check passed" title="Fidelity: faithful">
        ✓
      </span>
    );
  }

  const failed = verdict === "failed";
  return (
    <span
      className={`gutter-mark ${failed ? "failed" : "uncertain"}`}
      aria-label={failed ? "sealed fact altered" : "uncertain passage"}
      title={failed ? "Sealed fact altered" : "Uncertain — see margin note"}
    >
      !
    </span>
  );
}
