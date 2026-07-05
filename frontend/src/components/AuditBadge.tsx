// Audit state, rendered in the paragraph's left gutter (SPEC front).
// Trust is silent by default: the faithful check only appears on paragraph
// hover. Doubt is never silent: uncertain / violation marks stay visible,
// with the auditor's one-sentence reason in a tooltip. No modals, ever.

import type { AuditVerdict } from "../api";

export default function AuditBadge({
  verdict,
  note,
}: {
  verdict: AuditVerdict;
  note: string | null;
}) {
  if (verdict === "pending") return null;

  if (verdict === "faithful") {
    return (
      <span className="gutter-check" aria-label="fidelity check passed" title="Fidelity check: faithful">
        ✓
      </span>
    );
  }

  const failed = verdict === "failed";
  return (
    <span className={`tip-anchor gutter-mark ${failed ? "failed" : "uncertain"}`} tabIndex={0}>
      !
      <span className="tip" role="tooltip">
        {failed
          ? note ?? "A sealed fact was altered or missing after retry — original text shown for safety."
          : note ?? "The auditor is uncertain — verify this passage yourself."}
      </span>
    </span>
  );
}
