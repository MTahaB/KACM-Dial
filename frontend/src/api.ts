// Typed client matching SPEC §4 exactly. The types here mirror backend/models.py.
// Set VITE_USE_MOCK=1 (or import.meta.env.DEV with no backend) to use mock.ts.

export type Level = "expert" | "standard" | "plain" | "simple";
export type AuditVerdict = "faithful" | "uncertain" | "failed" | "pending";
export type InvariantKind = "amount" | "date" | "name" | "ref" | "pct";

export const LEVELS: Level[] = ["expert", "standard", "plain", "simple"];

export interface IngestResponse {
  doc_id: string;
  n_paragraphs: number;
}

export interface StatusResponse {
  progress: number; // 0..1
  paragraphs_done: number;
  total_jobs: number;
}

export interface ParagraphOut {
  id: number;
  html: string;
  level: Level;
  audit: AuditVerdict;
  audit_note: string | null;
}

export interface Invariant {
  id: string;
  text: string;
  kind: InvariantKind;
}

export interface DocResponse {
  title: string;
  paragraphs: ParagraphOut[];
  invariants: Invariant[];
}

export interface MetricsResponse {
  model_writer: string;
  model_auditor: string;
  tokens_per_s_avg: number;
  vram_gb: number;
  n_rewrites: number;
  n_uncertain: number;
  n_seal_violations_caught: number;
}

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";

import * as mock from "./mock";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  async ingest(text: string, title: string): Promise<IngestResponse> {
    if (USE_MOCK) return mock.ingest(text, title);
    const res = await fetch(`${BASE}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, title }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },

  status(docId: string): Promise<StatusResponse> {
    if (USE_MOCK) return mock.status(docId);
    return get<StatusResponse>(`/status/${docId}`);
  },

  doc(docId: string, level: Level): Promise<DocResponse> {
    if (USE_MOCK) return mock.doc(docId, level);
    return get<DocResponse>(`/doc/${docId}?level=${level}`);
  },

  paragraph(docId: string, parId: number, level: Level): Promise<ParagraphOut> {
    if (USE_MOCK) return mock.paragraph(docId, parId, level);
    return get<ParagraphOut>(`/paragraph/${docId}/${parId}?level=${level}`);
  },

  metrics(docId: string): Promise<MetricsResponse> {
    if (USE_MOCK) return mock.metrics(docId);
    return get<MetricsResponse>(`/metrics/${docId}`);
  },
};
