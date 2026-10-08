// The sales commission statement (FR-CRM-45): pure, no I/O, golden-tested.
//
// The base is cash collected in the month, **net of VAT** (the tax is the state's, not a sale),
// attributed per invoice line: a payment is shared over the invoice's billing items by their
// amounts, and each item's share goes to whoever the scheme says earns it — the owner of the deal
// the item's project was won under (the account's sales owner when the project came from no deal),
// the account's manager, or both at the scheme's split. A share whose earner is missing is paid to
// nobody: a split is never quietly turned into a whole.
//
// The rate is tiered on the person's whole month: each band of the base is paid at its own rate
// (marginal, like the tax brackets), so crossing a tier never lowers what was already earned.
import type { CommissionRule, CommissionTier } from "../schema";

/** One billing item's part of one payment, as the service reads it. */
export type Collection = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  accountName: string;
  receivedOn: string;
  /** The payment, VAT included. */
  paidVnd: number;
  invoiceSubtotalVnd: number;
  invoiceTotalVnd: number;
  /** This item's amount, and the invoice's items together: the payment is shared by them. */
  itemVnd: number;
  itemsVnd: number;
  dealOwnerId: string | null;
  accountManagerId: string | null;
};

export type CommissionLine = { paymentId: string; invoiceNumber: string; accountName: string; receivedOn: string; netVnd: number; shareBp: number; baseVnd: number; as: "deal_owner" | "account_manager" };
export type CommissionBand = { fromVnd: number; toVnd: number | null; rateBp: number; baseVnd: number; amountVnd: number };
export type CommissionTrace = { month: string; schemeId: string; schemeName: string; rule: CommissionRule; lines: CommissionLine[]; baseVnd: number; bands: CommissionBand[]; amountVnd: number };

const BP = 10_000;

/** The cash of one item's part of a payment, before VAT. Rounded to the đồng. */
export function netOf(collection: Pick<Collection, "paidVnd" | "invoiceSubtotalVnd" | "invoiceTotalVnd" | "itemVnd" | "itemsVnd">): number {
  if (collection.invoiceTotalVnd <= 0 || collection.itemsVnd <= 0) return 0;
  return Math.round((collection.paidVnd * collection.invoiceSubtotalVnd * collection.itemVnd) / (collection.invoiceTotalVnd * collection.itemsVnd));
}

/** Who earns an item's cash and what share of it, in basis points. */
export function earnerShares(rule: CommissionRule, collection: Pick<Collection, "dealOwnerId" | "accountManagerId">): { personId: string; shareBp: number; as: CommissionLine["as"] }[] {
  const owner = collection.dealOwnerId;
  const manager = collection.accountManagerId;
  if (rule.earner === "deal_owner") return owner ? [{ personId: owner, shareBp: BP, as: "deal_owner" }] : [];
  if (rule.earner === "account_manager") return manager ? [{ personId: manager, shareBp: BP, as: "account_manager" }] : [];
  const ownerBp = Math.min(Math.max(rule.splitOwnerBp, 0), BP);
  const shares: { personId: string; shareBp: number; as: CommissionLine["as"] }[] = [];
  if (owner && ownerBp > 0) shares.push({ personId: owner, shareBp: ownerBp, as: "deal_owner" });
  if (manager && BP - ownerBp > 0) {
    const same = shares.find((share) => share.personId === manager);
    if (same) same.shareBp += BP - ownerBp;
    else shares.push({ personId: manager, shareBp: BP - ownerBp, as: "account_manager" });
  }
  return shares;
}

/** The tiers as bands, lowest first. A scheme with no tier at 0 pays nothing below its first. */
export function bandsOf(tiers: readonly CommissionTier[]): { fromVnd: number; toVnd: number | null; rateBp: number }[] {
  const sorted = [...tiers].filter((tier) => tier.fromVnd >= 0 && tier.rateBp >= 0).sort((a, b) => a.fromVnd - b.fromVnd);
  return sorted.map((tier, index) => ({ fromVnd: tier.fromVnd, toVnd: sorted[index + 1]?.fromVnd ?? null, rateBp: tier.rateBp }));
}

/** A month's base through the bands: each band at its own rate. */
export function tieredAmount(tiers: readonly CommissionTier[], baseVnd: number): { bands: CommissionBand[]; amountVnd: number } {
  const bands = bandsOf(tiers).map((band) => {
    const top = band.toVnd === null ? baseVnd : Math.min(baseVnd, band.toVnd);
    const inBand = Math.max(0, top - band.fromVnd);
    return { ...band, baseVnd: inBand, amountVnd: Math.round((inBand * band.rateBp) / BP) };
  });
  return { bands, amountVnd: bands.reduce((sum, band) => sum + band.amountVnd, 0) };
}

/**
 * Every earner's statement for one scheme and one month. People with no base are left out; a
 * negative base (a payment removed after it was counted) is not the engine's business — the
 * service reads the payments as they stand.
 */
export function commissionStatements(scheme: { id: string; name: string; rule: CommissionRule }, month: string, collections: readonly Collection[]): Map<string, CommissionTrace> {
  const lines = new Map<string, CommissionLine[]>();
  for (const collection of collections) {
    const netVnd = netOf(collection);
    if (netVnd === 0) continue;
    for (const share of earnerShares(scheme.rule, collection)) {
      const line: CommissionLine = {
        paymentId: collection.paymentId,
        invoiceNumber: collection.invoiceNumber,
        accountName: collection.accountName,
        receivedOn: collection.receivedOn,
        netVnd,
        shareBp: share.shareBp,
        baseVnd: Math.round((netVnd * share.shareBp) / BP),
        as: share.as,
      };
      lines.set(share.personId, [...(lines.get(share.personId) ?? []), line]);
    }
  }
  const result = new Map<string, CommissionTrace>();
  for (const [personId, personLines] of lines) {
    const ordered = personLines.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.invoiceNumber.localeCompare(b.invoiceNumber) || a.paymentId.localeCompare(b.paymentId));
    const baseVnd = ordered.reduce((sum, line) => sum + line.baseVnd, 0);
    if (baseVnd <= 0) continue;
    const { bands, amountVnd } = tieredAmount(scheme.rule.tiers, baseVnd);
    result.set(personId, { month, schemeId: scheme.id, schemeName: scheme.name, rule: scheme.rule, lines: ordered, baseVnd, bands, amountVnd });
  }
  return result;
}

/** Is a rule one the service may store? Returns the first problem's key, or null. */
export function ruleProblem(rule: CommissionRule): string | null {
  if (rule.base !== "cash_collected") return "commission_base";
  if (rule.splitOwnerBp < 0 || rule.splitOwnerBp > BP) return "commission_split";
  if (rule.tiers.length === 0) return "commission_tiers";
  if (rule.tiers.some((tier) => !Number.isSafeInteger(tier.fromVnd) || tier.fromVnd < 0 || !Number.isInteger(tier.rateBp) || tier.rateBp < 0 || tier.rateBp > 3000)) return "commission_tiers";
  if (new Set(rule.tiers.map((tier) => tier.fromVnd)).size !== rule.tiers.length) return "commission_tiers";
  return null;
}
