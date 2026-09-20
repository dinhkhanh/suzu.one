// Value lists of the document module. Plain module: shared by the server, the forms and the seed.

/**
 * What sort of paper it is. Drives the numbering prefix and how the list is grouped.
 *
 * `offer` is the odd one out: an offer letter is about a **candidate**, who is not a person on the
 * books, so recruitment renders it with this module's engine and its own context rather than
 * through `generateDocument` (which takes a `subjectPersonId`). The kind exists here so that an
 * offer wording is designed, tiered and refused on exactly the same terms as a contract.
 */
export const DOCUMENT_KINDS = ["contract", "decision", "confirmation_letter", "offer", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The prefix in a document's number: SZM-**XN**-2026-0007. */
export const KIND_PREFIX: Record<DocumentKind, string> = { contract: "HD", decision: "QD", confirmation_letter: "XN", offer: "TM", other: "VB" };

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
