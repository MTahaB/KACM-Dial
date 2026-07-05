// The three §8 demo documents, embedded so the one-click chips work offline.
// Kept in sync with samples/*.md (the repo copies are the source of truth).

export interface Sample {
  key: string;
  chip: string; // label on the ingest chip
  title: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    key: "caf",
    chip: "🇫🇷 Lettre CAF",
    title: "Notification de trop-perçu — CAF",
    text: `# Notification de trop-perçu

Madame, Monsieur,

Suite au réexamen de votre dossier, la Caisse constate un trop-perçu de 1 240,50 € au titre de la période de janvier à mars 2026. En application de l'article L.553-2 du code de la sécurité sociale, cette somme doit être remboursée dans un délai de 30 jours à compter de la notification.

À défaut de remboursement dans le délai imparti, la Caisse procédera au recouvrement par retenues sur vos prestations à venir, dans la limite de la quotité saisissable prévue par la réglementation en vigueur.

Vous disposez d'un délai de deux mois pour contester cette décision devant la commission de recours amiable, par lettre recommandée avec accusé de réception adressée au siège de la Caisse.

Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.`,
  },
  {
    key: "bail",
    chip: "📄 Contrat de location",
    title: "Extrait de contrat de location",
    text: `# Extrait de contrat de location

ARTICLE 4 — LOYER ET CHARGES

Le locataire s'engage à payer un loyer mensuel de 850 € hors charges, augmenté d'une provision pour charges de 90 €, payable d'avance le 5 de chaque mois. Tout retard de paiement supérieur à huit jours entraîne l'application d'une pénalité de 40 € ainsi que des intérêts au taux légal.

ARTICLE 7 — DÉPÔT DE GARANTIE

Un dépôt de garantie équivalent à un mois de loyer hors charges, soit 850 €, est versé à la signature du présent contrat. Il est restitué dans un délai maximal de deux mois après la remise des clés, déduction faite des sommes dues au titre des réparations locatives, conformément à l'article 22 de la loi n° 89-462 du 6 juillet 1989.`,
  },
  {
    key: "physics",
    chip: "🧲 Physics course (EN)",
    title: "Newton's Second Law",
    text: `# Newton's Second Law

When a net external force acts on an object, the object accelerates in the direction of that force. The acceleration is directly proportional to the net force and inversely proportional to the object's mass, a relationship written as F = ma.

Because force and acceleration are vector quantities, the second law holds independently along each spatial axis. A force of 10 N applied to a 2 kg cart therefore produces an acceleration of 5 m/s², regardless of any perpendicular forces acting at the same time.

This law explains why the same push moves a shopping trolley more easily than a loaded truck: for a fixed force, a larger mass yields a smaller acceleration. It also underlies the design of everything from car braking distances to the thrust required to launch a rocket.`,
  },
];
