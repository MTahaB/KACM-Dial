// Fidelity audit indicator (SPEC §7). Tier 1 backend marks rewrites `pending`
// (no auditor yet); we render nothing for pending/faithful-on-expert to keep the
// page calm, a subtle check for faithful, and the orange note for uncertain.

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
      <span className="audit-badge faithful" aria-label="faithful" title="fidelity check: faithful">
        ✓
      </span>
    );
  }

  if (verdict === "failed") {
    return (
      <span className="audit-badge failed" aria-label="sealed fact altered">
        ⚠
        <span className="tip">A sealed fact was altered or missing after retry — original text shown for safety.</span>
      </span>
    );
  }

  // uncertain
  return (
    <span className="audit-badge uncertain" aria-label="uncertain" tabIndex={0}>
      ⚑
      <span className="tip">{note ?? "The auditor is uncertain — verify this passage yourself."}</span>
    </span>
  );
}
