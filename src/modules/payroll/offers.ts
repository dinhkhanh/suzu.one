// The net → gross tool for offers (FR-PAY-03), and its other direction: what a gross nets, for a
// hypothetical or for a person's own salary file (FR-AGT-17).
//
// Contracts are gross-based (SRS D12), so nothing here touches payroll: it answers "a candidate
// wants this much in hand — what gross do we write into the offer?" using the entity's own rules
// and the law in force on the month asked about. The arithmetic is the engine's
// (`engine/net-to-gross.ts`); this file only gathers what it needs.
//
// No authorization inside `quoteOffer` and `estimateNet`: their callers check `canManageCompensation`
// over the entity first. `estimateFromSalaryFile` reads the file through `getSalaryFile`, whose own
// gate (`canViewCompensationOf`) decides.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { addDays, type IsoDate } from "@/lib/dates";
import { listPayrollFacts } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { toProfileFacts } from "./calculation";
import { resolveCatalogue } from "./components";
import { grossForNet, netOf, type OfferTerms } from "./engine/net-to-gross";
import { payPeriodOf, type ProfileFacts } from "./engine/period";
import { getPayrollPolicy } from "./policies";
import { getSalaryFile } from "./salaries";
import { loadStatutoryParams } from "./statutory";

type Executor = Tx | ReturnType<typeof db>;

export type OfferRequest = {
  entityId: string;
  /** The month the offer is priced in: which statutory values apply. */
  month: string;
  netSalary: number;
  dependents: number;
  profile: "statutory" | "simple";
  taxResidency: "resident" | "non_resident";
  /** Probation, an intern, a collaborator: someone who does not contribute. */
  insuranceExempt: boolean;
  /** Allowances the offer includes beside the base salary. */
  allowances: { code: string; amount: number }[];
  /** A contribution base of its own, when the entity declares less than the gross. */
  insuranceSalary: number | null;
};

export type OfferQuote = {
  gross: number;
  net: number;
  exact: boolean;
  /** Where no gross nets the figure exactly: the nearest on each side. */
  nearest: { below: { gross: number; net: number } | null; above: { gross: number; net: number } | null } | null;
  /** The payslip behind the answer, so the offer can be explained line by line. */
  lines: { code: string; kind: string; amount: number }[];
  totals: { grossEarnings: number; employeeInsurance: number; pit: number; net: number; employerCost: number };
  /** Statutory values the chief accountant has not confirmed: the quote says so on its face. */
  unverifiedParameters: string[];
};

/** One ordinary full month priced on an entity's rules, whichever direction is asked. */
type PricedMonth = { entityId: string; month: string; dependents: number; profile: ProfileFacts; allowances: { code: string; amount: number }[]; insuranceSalary: number | null };

async function termsFor(priced: PricedMonth, executor: Executor): Promise<{ terms: OfferTerms; unverified: string[] }> {
  const period = payPeriodOf(priced.month, 0);
  const [entity] = await executor.select().from(schema.entity).where(eq(schema.entity.id, priced.entityId)).limit(1);
  if (!entity) throw new ActionError("entity_not_found");

  const [statutory, policy, catalogue] = await Promise.all([loadStatutoryParams(period.end, executor), getPayrollPolicy(priced.entityId, period.end, executor), resolveCatalogue(priced.entityId, period.end, executor)]);

  // The month's working days are not known for a month that has not happened: an offer is priced
  // on a whole month, so the divisor and the days paid cancel out whatever it is.
  const terms: OfferTerms = {
    month: priced.month,
    monthStandardDays: 22,
    wageRegion: asWageRegion(entity.wageRegion),
    dependents: priced.dependents,
    profile: priced.profile,
    insuranceSalary: priced.insuranceSalary === null ? { mode: "follow_gross" } : { mode: "fixed", amount: priced.insuranceSalary },
    allowances: priced.allowances.filter((allowance) => allowance.amount > 0),
    policy: policy.value,
    statutory: statutory.params,
    components: catalogue.map(toDefinition),
  };
  return { terms, unverified: statutory.unverified };
}

/** An offer's pay profile: a labour contract of three months or more unless the person is a non-resident. */
const offerProfile = (request: Pick<OfferRequest, "profile" | "taxResidency" | "insuranceExempt">): ProfileFacts => ({
  profile: request.profile,
  taxResidency: request.taxResidency,
  pitMethod: request.taxResidency === "non_resident" ? "flat_non_resident" : "progressive",
  pitCommitment: false,
  insuranceExemption: request.insuranceExempt ? "other" : null,
  unionMember: false,
});

const quoteOf = (gross: number, result: ReturnType<typeof netOf>["result"], unverified: string[], exact = true, nearest: OfferQuote["nearest"] = null): OfferQuote => ({
  gross,
  net: result.totals.net,
  exact,
  nearest,
  lines: result.lines.map((line) => ({ code: line.code, kind: line.kind, amount: line.amount })),
  totals: {
    grossEarnings: result.totals.grossEarnings,
    employeeInsurance: result.totals.employeeInsurance,
    pit: result.totals.pit,
    net: result.totals.net,
    employerCost: result.totals.employerCost,
  },
  unverifiedParameters: unverified,
});

/** How much gross an offer must promise to land on the net the candidate asked for. */
export async function quoteOffer(request: OfferRequest, executor: Executor = db()): Promise<OfferQuote> {
  if (request.netSalary <= 0) throw new ActionError("net_salary_required");
  const { terms, unverified } = await termsFor({ ...request, profile: offerProfile(request) }, executor);
  const answer = grossForNet(terms, request.netSalary);
  return { ...quoteOf(answer.gross, answer.result, unverified, answer.exact, answer.nearest ?? null), net: answer.net };
}

export type NetEstimateRequest = Omit<OfferRequest, "netSalary"> & { grossSalary: number };

/** What a gross base salary nets in an ordinary full month — the other direction of `quoteOffer`. */
export async function estimateNet(request: NetEstimateRequest, executor: Executor = db()): Promise<OfferQuote> {
  if (request.grossSalary <= 0) throw new ActionError("gross_salary_required");
  const { terms, unverified } = await termsFor({ ...request, profile: offerProfile(request) }, executor);
  return quoteOf(request.grossSalary, netOf(terms, request.grossSalary).result, unverified);
}

export type SalaryFileEstimate = {
  person: { personId: string; fullName: string; entityId: string };
  month: string;
  /** The structure the estimate is priced on: the one in force on the month's last day. */
  structureFrom: IsoDate;
  dependents: number;
  quote: OfferQuote;
};

/**
 * What a person's salary file nets in an ordinary full month (FR-AGT-17: "next month's pay of X"):
 * the structure and the approved pay profile in force on the month's last day, the dependants
 * registered for the month, and no overtime, absence or one-off input — an estimate, not a payslip.
 * null = the file is not the viewer's to see (`getSalaryFile`), or there is nothing to price.
 */
export async function estimateFromSalaryFile(viewer: { personId: string; principal: Principal }, personId: string, month: string, executor: Executor = db()): Promise<SalaryFileEstimate | null> {
  const file = await getSalaryFile(viewer, personId);
  if (!file || !file.person.entityId) return null;
  const first: IsoDate = `${month}-01`;
  const last = addDays(`${addDays(first, 31).slice(0, 7)}-01`, -1);
  const structure = file.structures.find((row) => row.validFrom <= last && (row.validTo === null || row.validTo >= first));
  const profile = file.profiles.find((row) => row.status === "approved" && row.validFrom <= last && (row.validTo === null || row.validTo >= last));
  if (!structure || !profile) return null;
  const [facts] = await listPayrollFacts({ personIds: [personId] }, month, executor);
  const dependents = facts?.dependents ?? 0;
  const { terms, unverified } = await termsFor({ entityId: structure.entityId, month, dependents, profile: toProfileFacts(profile), allowances: structure.terms.allowances, insuranceSalary: structure.terms.insuranceSalary }, executor);
  const gross = structure.terms.baseSalary;
  return { person: { personId, fullName: file.person.fullName, entityId: structure.entityId }, month, structureFrom: structure.validFrom, dependents, quote: quoteOf(gross, netOf(terms, gross).result, unverified) };
}

/** The allowance components an offer may include: the entity's structure components. */
export async function listOfferAllowances(entityId: string, month: string, executor: Executor = db()): Promise<{ code: string; name: string }[]> {
  const catalogue = await resolveCatalogue(entityId, payPeriodOf(month, 0).end, executor);
  return catalogue.filter((row) => row.source === "structure" && row.code !== "BASE").map((row) => ({ code: row.code, name: row.name }));
}

const asWageRegion = (region: number | null): 1 | 2 | 3 | 4 => (region === 2 || region === 3 || region === 4 ? region : 1);

const toDefinition = (row: typeof schema.payComponent.$inferSelect) => ({
  versionId: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  category: row.category,
  source: row.source,
  taxTreatment: row.taxTreatment,
  exemptCap: row.exemptCap,
  subjectToInsurance: row.subjectToInsurance,
  proration: row.proration,
  roundingRule: row.roundingRule as "half_up",
  formula: row.formula,
  sortOrder: row.sortOrder,
});
