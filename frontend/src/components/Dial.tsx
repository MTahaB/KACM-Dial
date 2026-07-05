// The Dial (SPEC §7): 4 detents, keyboard accessible, and — for the demo's
// signature scrub — continuously draggable: the thumb tracks the pointer and
// the document morphs the instant a detent is crossed (levels are prefetched,
// so every crossing is a zero-latency swap). Snaps to the nearest detent on
// release. Keyboard arrows still work through the visually-hidden range input.

import { useCallback, useRef, useState } from "react";
import type { Level } from "../api";
import { LEVELS } from "../api";
import { LEVEL_LABEL } from "../text";

export default function Dial({
  level,
  onChange,
}: {
  level: Level;
  onChange: (l: Level) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null); // continuous 0..3 while dragging

  const idx = LEVELS.indexOf(level);
  const pos = scrub ?? idx;
  const pct = (pos / (LEVELS.length - 1)) * 100;

  const valueFromPointer = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * (LEVELS.length - 1);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      trackRef.current?.setPointerCapture(e.pointerId);
      const v = valueFromPointer(e.clientX);
      setScrub(v);
      const l = LEVELS[Math.round(v)];
      if (l !== level) onChange(l);
    },
    [level, onChange, valueFromPointer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (scrub === null) return;
      const v = valueFromPointer(e.clientX);
      setScrub(v);
      const l = LEVELS[Math.round(v)];
      if (l !== level) onChange(l); // instant — reads from the prefetch cache
    },
    [scrub, level, onChange, valueFromPointer]
  );

  const onPointerUp = useCallback(() => setScrub(null), []);

  return (
    <div className="dial" role="group" aria-label="Reading level">
      <div className="dial-labels">
        {LEVELS.map((l) => (
          <button
            key={l}
            className={l === level ? "active" : ""}
            onClick={() => onChange(l)}
            aria-pressed={l === level}
          >
            {LEVEL_LABEL[l]}
          </button>
        ))}
      </div>

      <div
        className={`dial-track ${scrub !== null ? "scrubbing" : ""}`}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="dial-detents">
          {LEVELS.map((l, i) => (
            <div key={l} className={`dial-detent ${i <= pos ? "filled" : ""}`} />
          ))}
        </div>
        <div className="dial-thumb" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={LEVELS.length - 1}
          step={1}
          value={idx}
          aria-label="Reading level"
          aria-valuetext={LEVEL_LABEL[level]}
          onChange={(e) => onChange(LEVELS[Number(e.target.value)])}
        />
      </div>
    </div>
  );
}
