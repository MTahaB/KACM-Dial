// Mini horizontal dial (56px) — one atop each split-view column. Four level
// pills, keyboard accessible. The vertical rail (DialRail) is the signature
// control of the single-reader view; this is its compact sibling.

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
  return (
    <div className="mini-dial" role="group" aria-label="Reading level">
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
  );
}
