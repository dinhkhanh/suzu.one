// Value lists of the document module. Plain module: shared by the server, the forms and the seed.

/** What sort of paper it is. Drives the numbering prefix and how the list is grouped. */
export const DOCUMENT_KINDS = ["contract", "decision", "confirmation_letter", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The prefix in a document's number: SZM-**XN**-2026-0007. */
export const KIND_PREFIX: Record<DocumentKind, string> = { contract: "HD", decision: "QD", confirmation_letter: "XN", other: "VB" };

/** What is printed at the head and the foot of the page; per template, so each entity has its own. */
export type LetterheadFields = {
  companyName?: string;
  address?: string;
  taxCode?: string;
  phone?: string;
  /** Who signs at the bottom, and as what. */
  representative?: string;
  representativeTitle?: string;
  /** "TP. Hồ Chí Minh" — the place in the dateline. */
  place?: string;
};
