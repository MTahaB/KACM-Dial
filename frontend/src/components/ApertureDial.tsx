// The aperture dial — the signature control. A vertical brushed-brass cylinder
// with four engraved graduations and a brass cursor ring you drag. While
// dragging, the ring tracks the pointer directly; on release it snaps to the
// nearest detent with an elastic overshoot (the CSS ease has a >1 endpoint).
// Each detent flashes as the ring crosses it. Keyboard: ↑/↓ via a hidden range
// input (focus rings the cylinder). Detents light up as their level generates.

import { useCallback, useRef, useState } from "react";
import type { Level } from "../api";
import { LEVELS } from "../api";
import { LEVEL_LABEL, LEVEL_TAG } from "../text";

const N = LEVELS.length - 1; // 3
const SNAP_DEADZONE = 0.1; // ±10% of the scale around a detent

export default function ApertureDial({
  level,
  onChange,
  complete,
  meter,
}: {
  level: Level;
  onChange: (l: Level) => void;
  complete: Record<Level, boolean>;
  meter: string | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const gradRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<number | null>(null); // continuous 0..N while dragging
  const lastCrossed = useRef(LEVELS.indexOf(level));

  const idx = LEVELS.indexOf(level);
  // cursor sits at the detent normally; follows the pointer continuously while dragging
  const pos = dragPos ?? idx;

  const valueFromPointer = useCallback((clientY: number) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return frac * N;
  }, []);

  const snap = useCallback((v: number) => {
    for (let i = 0; i <= N; i++) {
      if (Math.abs(v - i) <= SNAP_DEADZONE * N) return i;
    }
    return Math.round(v);
  }, []);

  const flash = useCallback((i: number) => {
    const el = gradRefs.current[i];
    if (!el) return;
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 80);
  }, []);

  const crossTo = useCallback(
    (v: number) => {
      const nearest = Math.round(v);
      if (nearest !== lastCrossed.current) {
        lastCrossed.current = nearest;
        flash(nearest);
        if (LEVELS[nearest] !== level) onChange(LEVELS[nearest]);
      }
    },
    [flash, level, onChange]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      const v = valueFromPointer(e.clientY);
      setDragPos(v);
      crossTo(v);
    },
    [valueFromPointer, crossTo]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const v = valueFromPointer(e.clientY);
      setDragPos(v);
      crossTo(v);
    },
    [dragging, valueFromPointer, crossTo]
  );

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    const snapped = dragPos !== null ? snap(dragPos) : idx;
    setDragPos(null); // cursor animates from here to the detent (elastic CSS)
    lastCrossed.current = snapped;
    if (LEVELS[snapped] !== level) onChange(LEVELS[snapped]);
  }, [dragging, dragPos, snap, idx, level, onChange]);

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
    <div className="aperture-rail" onWheel={onWheel}>
      <div className="ap-window">
        <div className="lvl">{LEVEL_LABEL[level].toUpperCase()}</div>
        <div className="meta">
          {meter && <>{meter} · </>}
          {LEVEL_TAG[level]}
        </div>
      </div>
      <div
        ref={bodyRef}
        className={`ap-body ${dragging ? "grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="ap-cylinder" />
        {LEVELS.map((l, i) => (
          <div
            key={l}
            ref={(el) => (gradRefs.current[i] = el)}
            className={[
              "ap-grad",
              l === level ? "active" : "",
              complete[l] ? "" : "pending",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ top: `${(i / N) * 100}%` }}
            onClick={() => onChange(l)}
          >
            <span className="tick" />
            <span className="label">{LEVEL_LABEL[l].toUpperCase()}</span>
          </div>
        ))}
        <div className="ap-cursor" style={{ top: `${(pos / N) * 100}%` }} />
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
    </div>
  );
}
