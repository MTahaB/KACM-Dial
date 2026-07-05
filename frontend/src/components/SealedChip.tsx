// Sealed invariant chip: pale amber, 1px amber border, 10px padlock (inline
// SVG — no emoji in the UI), tabular numerals, never breaks across lines.
// data-seal-id lets the Reader FLIP-animate chips across level changes so the
// facts visibly hold still while the prose rewrites itself around them.

export default function SealedChip({ text, sealId }: { text: string; sealId?: string }) {
  return (
    <span
      className="seal"
      data-seal-id={sealId}
      title="Sealed fact — identical at every level"
    >
      <span className="lock" aria-hidden>
        <svg viewBox="0 0 10 10" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.2" y="4.2" width="7.6" height="5" rx="1.1" />
          <path
            d="M3 4.5V3.2a2 2 0 1 1 4 0v1.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </span>
      {text}
    </span>
  );
}
