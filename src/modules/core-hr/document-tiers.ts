// How sensitive each kind of vault document is (SRS §2.2). A plain module: the forms use it to say
// who will be able to see an upload, the service to decide it.
import type { Tier } from "@/modules/platform/rbac/roles";
import type { DOCUMENT_CATEGORIES } from "./enums";

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_TIERS: Record<DocumentCategory, Tier> = {
  id_scan: "restricted",
  health_check: "restricted",
  // Signed contracts and decisions state pay.
  contract: "compensation",
  decision: "compensation",
  degree: "personal",
  certificate: "personal",
  other: "personal",
};

// Files that hang off other records.
export const CONTRACT_FILE_TIER: Tier = "compensation";
export const DEPENDENT_FILE_TIER: Tier = "restricted";
