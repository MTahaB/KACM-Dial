// Sealed invariant chip (SPEC §7): rounded chip, lock glyph, monospace numerals.
// Tier 1 renders no seals (backend emits none yet), but Paragraph resolves any
// <seal>…</seal> markup through this component so Tier 2 is a drop-in.

export default function SealedChip({ text }: { text: string }) {
  return (
    <span className="seal" title="sealed fact — identical at every level">
      <span className="lock">🔒</span>
      {text}
    </span>
  );
}
