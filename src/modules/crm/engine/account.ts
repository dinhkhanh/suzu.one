// Accounts, pure: the lifecycle an account's facts suggest (FR-CRM-01), the tax code's shape, and
// the duplicate guard for accounts and contacts (FR-CRM-07).
import { addDays, type IsoDate } from "@/lib/dates";
import { toSearchKey } from "@/lib/text";
import type { Lifecycle } from "../enums";

/** How long without work before an active client is dormant, and a dormant one churned. */
export const DORMANT_AFTER_DAYS = 183;
export const CHURNED_AFTER_DAYS = 365;
/** A deal won this long ago still makes a client active. */
export const ACTIVE_AFTER_WIN_DAYS = 365;

export type LifecycleFacts = {
  openProjects: number;
  /** The last day anything happened with the client: a project's last activity, a won deal, an invoice. */
  lastWorkOn: IsoDate | null;
  lastWonOn: IsoDate | null;
  /** Did the client ever buy anything (a won deal or any project)? */
  everBought: boolean;
};

/**
 * The lifecycle the facts suggest. An open project or a deal won in the last year → active; a client
 * who bought before and has been quiet for six months → dormant, for a year → churned; one who never
 * bought → prospect. A person may set it by hand, and then the proposal no longer moves it.
 */
export function proposeLifecycle(facts: LifecycleFacts, today: IsoDate): Lifecycle {
  if (facts.openProjects > 0) return "active";
  if (facts.lastWonOn && facts.lastWonOn >= addDays(today, -ACTIVE_AFTER_WIN_DAYS)) return "active";
  if (!facts.everBought) return "prospect";
  const last =
    [facts.lastWorkOn, facts.lastWonOn]
      .filter((day): day is IsoDate => !!day)
      .sort()
      .at(-1) ?? null;
  if (!last) return "dormant";
  if (last < addDays(today, -CHURNED_AFTER_DAYS)) return "churned";
  if (last < addDays(today, -DORMANT_AFTER_DAYS)) return "dormant";
  return "active";
}

/**
 * A Vietnamese tax code (mã số thuế): ten digits, or ten digits, a dash and three for a branch.
 * Spaces and dots people type are removed; anything else is not a tax code.
 */
export function normalizeTaxCode(value: string): string | null {
  const cleaned = value.replace(/[\s.]/g, "");
  return /^\d{10}(-\d{3})?$/.test(cleaned) ? cleaned : null;
}

// Words that say what kind of company a name is, not which one: "Công ty TNHH ABC" is ABC.
const COMPANY_WORDS = new Set([
  "cong",
  "ty",
  "tnhh",
  "co",
  "phan",
  "cp",
  "jsc",
  "ltd",
  "llc",
  "company",
  "corp",
  "corporation",
  "group",
  "tap",
  "doan",
  "mtv",
  "thuong",
  "mai",
  "dich",
  "vu",
  "tm",
  "dv",
  "vietnam",
  "viet",
  "nam",
  "inc",
  "the",
]);

/** A company name reduced to what tells it apart, for comparison only. */
export function companyKey(name: string): string {
  return toSearchKey(name)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word && !COMPANY_WORDS.has(word))
    .join(" ");
}

export type AccountCandidate = { name: string; legalName?: string | null; taxCode?: string | null };
export type ExistingAccount = { clientId: string; name: string; legalName: string | null; taxCode: string | null };
export type DuplicateReason = "tax_code" | "name";

/** Accounts a new one probably duplicates: the same tax code, or the same distinguishing name. */
export function likelyDuplicateAccounts(candidate: AccountCandidate, existing: readonly ExistingAccount[]): { clientId: string; reason: DuplicateReason }[] {
  const taxCode = candidate.taxCode ? normalizeTaxCode(candidate.taxCode) : null;
  const keys = new Set(
    [candidate.name, candidate.legalName]
      .filter((value): value is string => !!value)
      .map(companyKey)
      .filter((key) => key.length >= 2),
  );
  const found: { clientId: string; reason: DuplicateReason }[] = [];
  for (const account of existing) {
    if (taxCode && account.taxCode && normalizeTaxCode(account.taxCode) === taxCode) found.push({ clientId: account.clientId, reason: "tax_code" });
    else if ([account.name, account.legalName].some((value) => !!value && keys.has(companyKey(value)))) found.push({ clientId: account.clientId, reason: "name" });
  }
  return found;
}

/** Digits only, the country code folded to a leading 0: "+84 90 123 4567" and "0901234567" match. */
export function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
}

export type ContactCandidate = { fullName: string; email?: string | null; phone?: string | null };
export type ExistingContact = { id: string; fullName: string; email: string | null; phone: string | null };

/** Contacts of the same account a new one probably duplicates: the same email, phone, or name. */
export function likelyDuplicateContacts(candidate: ContactCandidate, existing: readonly ExistingContact[]): string[] {
  const email = candidate.email?.trim().toLowerCase() || null;
  const phone = candidate.phone ? phoneKey(candidate.phone) : null;
  const name = toSearchKey(candidate.fullName);
  return existing
    .filter((contact) => (email && contact.email?.trim().toLowerCase() === email) || (phone && phone.length >= 8 && contact.phone && phoneKey(contact.phone) === phone) || toSearchKey(contact.fullName) === name)
    .map((contact) => contact.id);
}
