// The Dial — a fixed vertical rail on the right of the paper (280px), the
// signature object of the product. Four detents with ticks + labels, a 22px
// circular indigo knob you drag. Magnetic snap to detents (±8% dead zone),
// click on a detent, ↑/↓ arrows, Alt+wheel. Detents "light up" as their level
// finishes generating. Below the rail, the readability tag of the current level.

import { useCallback, useRef, useState } from "react";
import type { Level } from "../api";
import { LEVELS } from "../api";
import { LEVEL_LABEL, LEVEL_TAG } from "../text";

const N = LEVELS.length - 1; // 3

export default function DialRail({
  level,
  onChange,
  complete,
  meter,
}: {
  level: Level;
  onChange: (l: Level) => void;
  complete: Record<Level, boolean>;
  meter: string | null; // "~4 min" or null while unknown
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // continuous 0..3 while dragging

  const idx = LEVELS.indexOf(level);
  const pos = drag ?? idx;
  const topPct = (pos / N) * 100;

  const valueFromPointer = useCallback((clientY: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return frac * N;
  }, []);

  // magnetic snap: inside ±8% of a detent → that detent; otherwise nearest
  const snap = useCallback((v: number) => {
    for (let i = 0; i <= N; i++) {
      if (Math.abs(v - i) <= 0.08 * N) return i;
    }
    return Math.round(v);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const v = valueFromPointer(e.clientY);
      setDrag(v);
      const l = LEVELS[snap(v)];
      if (l !== level) onChange(l);
    },
    [level, onChange, snap, valueFromPointer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag === null) return;
      const v = valueFromPointer(e.clientY);
      setDrag(v);
      const l = LEVELS[snap(v)];
      if (l !== level) onChange(l); // zero-latency: levels are prefetched
    },
    [drag, level, onChange, snap, valueFromPointer]
  );

  const onPointerUp = useCallback(() => setDrag(null), []);

  // Alt+wheel steps the level
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const next = Math.min(N, Math.max(0, idx + (e.deltaY > 0 ? 1 : -1)));
      if (next !== idx) onChange(LEVELS[next]);
    },
    [idx, onChange]
  );

  return (
    <div className="dial-rail" onWheel={onWheel}>
      <div
        className={`rail-body ${drag !== null ? "grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="rail-track" ref={trackRef} />
        {LEVELS.map((l, i) => (
          <div
            key={l}
            className={[
              "rail-detent",
              l === level ? "active" : "",
              complete[l] ? "lit" : "pending",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ top: `${(i / N) * 100}%` }}
            onClick={() => onChange(l)}
          >
            <span className="lbl">{LEVEL_LABEL[l]}</span>
            <span className="tick" />
          </div>
        ))}
        <div className="rail-knob" style={{ top: `${topPct}%` }} />
        <input
          type="range"
          min={0}
          max={N}
          step={1}
          value={idx}
          aria-label="Reading level"
          aria-valuetext={LEVEL_LABEL[level]}
          aria-orientation="vertical"
          onChange={(e) => onChange(LEVELS[Number(e.target.value)])}
        />
      </div>
      <div className="rail-meter">
        {meter && <>{meter} · </>}
        {LEVEL_TAG[level]}
      </div>
    </div>
  );
}
