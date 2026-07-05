// Canned responses implementing all five §4 endpoints, so UI work starts at H+0
// without a running backend (SPEC §4 rules). Enable with VITE_USE_MOCK=1.

import type {
  DocResponse,
  IngestResponse,
  Invariant,
  Level,
  MetricsResponse,
  ParagraphOut,
  StatusResponse,
} from "./api";

const TITLE = "Notification de trop-perçu — CAF";

// Four levels of the same three paragraphs, hand-written to demo the dial morph.
const TEXT: Record<Level, string[]> = {
  expert: [
    "Suite au réexamen de votre dossier, la Caisse constate un trop-perçu de 1 240,50 € au titre de la période de janvier à mars 2026. En application de l'article L.553-2 du code de la sécurité sociale, cette somme doit être remboursée dans un délai de 30 jours à compter de la notification.",
    "À défaut de remboursement dans le délai imparti, la Caisse procédera au recouvrement par retenues sur vos prestations à venir, dans la limite de la quotité saisissable prévue par la réglementation en vigueur.",
    "Vous disposez d'un délai de deux mois pour contester cette décision devant la commission de recours amiable, par lettre recommandée avec accusé de réception.",
  ],
  standard: [
    "Après un nouvel examen de votre dossier, la Caisse a versé 1 240,50 € de trop sur la période de janvier à mars 2026. Selon l'article L.553-2 du code de la sécurité sociale, vous devez rembourser cette somme sous 30 jours après réception de ce courrier.",
    "Si vous ne remboursez pas dans ce délai, la Caisse retiendra le montant sur vos futures prestations, dans les limites fixées par la loi.",
    "Vous avez deux mois pour contester cette décision auprès de la commission de recours amiable, par lettre recommandée avec accusé de réception.",
  ],
  plain: [
    "La Caisse vous a payé 1 240,50 € de trop entre janvier et mars 2026. La loi (article L.553-2) vous demande de rendre cette somme. Vous avez 30 jours après ce courrier pour la rembourser.",
    "Si vous ne payez pas à temps, la Caisse retiendra l'argent sur vos prochaines aides. Elle respectera les limites fixées par la loi.",
    "Vous n'êtes pas d'accord ? Vous avez deux mois pour le dire à la commission de recours amiable. Envoyez une lettre recommandée avec accusé de réception.",
  ],
  simple: [
    "La Caisse vous a versé 1 240,50 € en trop entre janvier et mars 2026. Vous devez rendre cet argent. Vous avez 30 jours pour le faire, à partir de cette lettre. C'est la règle L.553-2.",
    "Si vous ne rendez pas l'argent à temps, la Caisse le reprendra petit à petit sur vos futures aides.",
    "Vous pensez que c'est une erreur ? Vous avez deux mois pour le dire. Écrivez à la commission de recours amiable, en lettre recommandée.",
  ],
};

const INVARIANTS: Invariant[] = [
  { id: "inv0", text: "1 240,50 €", kind: "amount" },
  { id: "inv1", text: "janvier à mars 2026", kind: "date" },
  { id: "inv2", text: "L.553-2", kind: "ref" },
  { id: "inv3", text: "30 jours", kind: "date" },
  { id: "inv4", text: "deux mois", kind: "date" },
];

const AUDIT: Array<ParagraphOut["audit"]> = ["faithful", "faithful", "uncertain"];
const AUDIT_NOTE: Array<string | null> = [
  null,
  null,
  "The rewrite drops the recorded-delivery requirement's legal weight; verify this passage yourself.",
];

const DOC_ID = "mockdoc00001";

// Mirror the real backend: wrap invariant occurrences in <seal id="..">…</seal>
// so the offline mock exercises SealedChip exactly like a live /doc response.
function sealHtml(text: string): string {
  let out = text;
  const byLen = [...INVARIANTS].sort((a, b) => b.text.length - a.text.length);
  for (const inv of byLen) {
    out = out.replace(inv.text, `<seal id="${inv.id}">${inv.text}</seal>`);
  }
  return out;
}

// Simulated generation: the mock "develops" the document over a few seconds so
// the offline demo shows the same photo-develop moment as the real backend.
const DEVELOP_TOTAL_MS = 7000;
let ingestT0 = 0;

function developProgress(): number {
  if (!ingestT0) return 1;
  return Math.min(1, (Date.now() - ingestT0) / DEVELOP_TOTAL_MS);
}

export async function ingest(_t: string, _title: string): Promise<IngestResponse> {
  ingestT0 = Date.now();
  return { doc_id: DOC_ID, n_paragraphs: TEXT.expert.length };
}

export async function status(_docId: string): Promise<StatusResponse> {
  const total = TEXT.expert.length * 3;
  const p = developProgress();
  return {
    progress: p,
    paragraphs_done: Math.round(p * total),
    total_jobs: total,
  };
}

export async function doc(_docId: string, level: Level): Promise<DocResponse> {
  const p = developProgress();
  const n = TEXT.expert.length;
  const paragraphs: ParagraphOut[] = TEXT[level].map((html, id) => {
    // Paragraphs "develop" top-to-bottom: not-yet-generated ones serve the
    // original text marked pending, exactly like the real backend fallback.
    const developed = level === "expert" || (id + 1) / n <= p;
    if (!developed) {
      return {
        id,
        html: sealHtml(TEXT.expert[id]),
        level,
        audit: "pending",
        audit_note: null,
      };
    }
    return {
      id,
      html: sealHtml(html),
      level,
      audit: level === "expert" ? "faithful" : AUDIT[id] ?? "faithful",
      audit_note: level === "expert" ? null : AUDIT_NOTE[id] ?? null,
    };
  });
  return { title: TITLE, paragraphs, invariants: INVARIANTS };
}

export async function paragraph(
  _docId: string,
  parId: number,
  level: Level
): Promise<ParagraphOut> {
  return {
    id: parId,
    html: sealHtml(TEXT[level][parId] ?? ""),
    level,
    audit: level === "expert" ? "faithful" : AUDIT[parId] ?? "faithful",
    audit_note: level === "expert" ? null : AUDIT_NOTE[parId] ?? null,
  };
}

export async function metrics(_docId: string): Promise<MetricsResponse> {
  return {
    model_writer: "gemma3:4b-it-qat",
    model_auditor: "nemotron-mini:latest",
    tokens_per_s_avg: 47.3,
    vram_gb: 6.2,
    n_rewrites: TEXT.expert.length * 3,
    n_uncertain: 1,
    n_seal_violations_caught: 0,
  };
}
