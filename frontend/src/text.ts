// Shared text helpers used by both the single Reader and the SplitView columns.
// The §4 API contract carries no is_heading flag, so headings are inferred on the
// client exactly as the backend chunker detects them (leading #, short ALL-CAPS).

import { LEVELS, type Level } from "./api";

export function isHeading(html: string): boolean {
  const s = html.trim();
  if (!s || s.includes("\n")) return false;
  if (s.startsWith("#")) return true;
  const letters = [...s].filter((c) => /\p{L}/u.test(c));
  return letters.length > 0 && s.length < 80 && s === s.toUpperCase();
}

export function displayHtml(html: string): string {
  return html.replace(/^#{1,6}\s+/, "");
}

// Semantic zoom direction. LEVELS = [expert, standard, plain, simple]; index 0 is
// the MOST detailed (original). "More detail" moves toward expert, "less" toward simple.
export function moreDetail(level: Level): Level {
  return LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];
}

export function lessDetail(level: Level): Level {
  return LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + 1)];
}

export const LEVEL_LABEL: Record<Level, string> = {
  expert: "Expert",
  standard: "Standard",
  plain: "Plain",
  simple: "Simple",
};

// Readability tag shown under the dial rail (SPEC front: "~4 min · reading level").
export const LEVEL_TAG: Record<Level, string> = {
  expert: "original text",
  standard: "educated adult",
  plain: "plain language",
  simple: "age-14 reading",
};

// Reading-time estimate (~200 wpm). Strips <seal> markup before counting.
export function readingSeconds(paragraphs: { html: string }[]): number {
  const words = paragraphs
    .map((p) => p.html.replace(/<[^>]+>/g, " "))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.round((words / 200) * 60);
}

export function formatReadingTime(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s >= 30 ? `${m} min 30` : `${m} min`;
}
