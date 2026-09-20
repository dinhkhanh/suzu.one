// The net → gross tool for offers (FR-PAY-03).
//
// Contracts are gross-based (SRS D12), so nothing here touches payroll: it answers "a candidate
// wants this much in hand — what gross do we write into the offer?" using the entity's own rules
// and the law in force on the month asked about. The arithmetic is the engine's
// (`engine/net-to-gross.ts`); this file only gathers what it needs.
//
// No authorization inside: the action checks `canManageCompensation` over the entity first.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { resolveCatalogue } from "./components";
import { grossForNet, type OfferTerms } from "./engine/net-to-gross";
import { payPeriodOf, type ProfileFacts } from "./engine/period";
import { getPayrollPolicy } from "./policies";
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

/** How much gross an offer must promise to land on the net the candidate asked for. */
export async function quoteOffer(request: OfferRequest, executor: Executor = db()): Promise<OfferQuote> {
  if (request.netSalary <= 0) throw new ActionError("net_salary_required");
  const period = payPeriodOf(request.month, 0);
  const [entity] = await executor.select().from(schema.entity).where(eq(schema.entity.id, request.entityId)).limit(1);
  if (!entity) throw new ActionError("entity_not_found");

  const [statutory, policy, catalogue] = await Promise.all([loadStatutoryParams(period.end, executor), getPayrollPolicy(request.entityId, period.end, executor), resolveCatalogue(request.entityId, period.end, executor)]);

  const profile: ProfileFacts = {
    profile: request.profile,
    taxResidency: request.taxResidency,
    // An offer is a labour contract of three months or more unless the person is a non-resident.
    pitMethod: request.taxResidency === "non_resident" ? "flat_non_resident" : "progressive",
    pitCommitment: false,
    insuranceExemption: request.insuranceExempt ? "other" : null,
    unionMember: false,
  };

  // The month's working days are not known for a month that has not happened: an offer is priced
  // on a whole month, so the divisor and the days paid cancel out whatever it is.
  const terms: OfferTerms = {
    month: request.month,
    monthStandardDays: 22,
    wageRegion: asWageRegion(entity.wageRegion),
    dependents: request.dependents,
    profile,
    insuranceSalary: request.insuranceSalary === null ? { mode: "follow_gross" } : { mode: "fixed", amount: request.insuranceSalary },
    allowances: request.allowances.filter((allowance) => allowance.amount > 0),
    policy: policy.value,
    statutory: statutory.params,
    components: catalogue.map(toDefinition),
  };

  const answer = grossForNet(terms, request.netSalary);
  return {
    gross: answer.gross,
    net: answer.net,
    exact: answer.exact,
    nearest: answer.nearest ?? null,
    lines: answer.result.lines.map((line) => ({ code: line.code, kind: line.kind, amount: line.amount })),
    totals: {
      grossEarnings: answer.result.totals.grossEarnings,
      employeeInsurance: answer.result.totals.employeeInsurance,
      pit: answer.result.totals.pit,
      net: answer.result.totals.net,
      employerCost: answer.result.totals.employerCost,
    },
    unverifiedParameters: statutory.unverified,
  };
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
