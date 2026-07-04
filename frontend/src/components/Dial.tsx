// The Dial (SPEC §7): horizontal slider, 4 detents, keyboard accessible, big
// enough to read in the video. The label row doubles as click targets; a native
// range input overlays the track for arrow-key / drag control.

import type { Level } from "../api";
import { LEVELS } from "../api";

const LABELS: Record<Level, string> = {
  expert: "Expert",
  standard: "Standard",
  plain: "Plain",
  simple: "Simple",
};

export default function Dial({
  level,
  onChange,
}: {
  level: Level;
  onChange: (l: Level) => void;
}) {
  const idx = LEVELS.indexOf(level);
  const pct = (idx / (LEVELS.length - 1)) * 100;

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
            {LABELS[l]}
          </button>
        ))}
      </div>

      <div className="dial-track">
        <div className="dial-detents">
          {LEVELS.map((l, i) => (
            <div
              key={l}
              className={`dial-detent ${i <= idx ? "filled" : ""}`}
              onClick={() => onChange(l)}
            />
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
          aria-valuetext={LABELS[level]}
          onChange={(e) => onChange(LEVELS[Number(e.target.value)])}
        />
      </div>
    </div>
  );
}
