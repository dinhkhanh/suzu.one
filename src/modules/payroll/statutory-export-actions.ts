"use server";
// Generating a statutory filing's data (FR-PAY-35). `payroll:propose` over the entity — C&B and
// the owner — because every one of these files names people and carries their tax code, their
// social-insurance number and their national ID.
//
// The file comes back **through the action's result**, as text, and is saved by the browser; it is
// never written to storage. The audit row says which filing, for which entity and period, and how
// many rows left — never a figure from inside it, and never an identifier of a person.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { buildD02lt } from "./exports/statutory/d02lt";
import { buildDependants } from "./exports/statutory/dependants";
import { buildFinalization, buildFinalizationAppendix1, buildFinalizationAppendix2, buildWithholdingCertificateData } from "./exports/statutory/pit-finalization";
import { buildPitMonthly, buildPitWorkingSheet } from "./exports/statutory/pit-monthly";
import type { StatutoryFile } from "./exports/statutory/format";
import { canManageCompensation } from "./policy";
import { STATUTORY_EXPORTS, type StatutoryExportKey } from "./statutory-kinds";
import { dependantRows, finalizationRows, insuranceChanges, pitPeriodRows, withholdingCertificate } from "./statutory-exports";

/** A month "2026-08", a quarter "2026-Q3" or a year "2026" — each filing says which it takes. */
const period = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/);

const exportPipeline = createAction({
  name: "payroll_statutory.export",
  stepUp: true,
  input: z.object({ kind: z.enum(STATUTORY_EXPORTS), entityId: z.uuid(), period }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const file = await build(input.kind, user.principal, input.entityId, input.period);
    if (!file) throw new ActionError("statutory_export_not_available");
    return {
      data: { fileName: file.fileName, content: file.content, contentType: file.contentType, rowCount: file.rowCount, caveats: file.caveats },
      audit: {
        resource: { type: "payroll_statutory_export", id: `${input.kind}:${input.period}`, entityId: input.entityId },
        summary: `${input.kind} ${input.period}`,
        after: { kind: input.kind, period: input.period, rows: file.rowCount },
      },
    };
  },
});

type Principal = Parameters<typeof insuranceChanges>[0];

async function build(kind: StatutoryExportKey, principal: Principal, entityId: string, period: string): Promise<StatutoryFile | null> {
  switch (kind) {
    case "d02lt": {
      const built = await insuranceChanges(principal, entityId, period);
      return built && buildD02lt(built);
    }
    case "pit_monthly": {
      const built = await pitPeriodRows(principal, entityId, period);
      return built && buildPitMonthly(built);
    }
    case "pit_monthly_detail": {
      const built = await pitPeriodRows(principal, entityId, period);
      return built && buildPitWorkingSheet(built);
    }
    case "pit_finalization": {
      const built = await finalizationRows(principal, entityId, Number(period.slice(0, 4)));
      return built && buildFinalization(built);
    }
    case "pit_finalization_appendix1": {
      const built = await finalizationRows(principal, entityId, Number(period.slice(0, 4)));
      return built && buildFinalizationAppendix1(built);
    }
    case "pit_finalization_appendix2": {
      const built = await finalizationRows(principal, entityId, Number(period.slice(0, 4)));
      return built && buildFinalizationAppendix2(built);
    }
    case "dependants": {
      const built = await dependantRows(principal, entityId, period);
      return built && buildDependants(built);
    }
  }
}

export async function exportStatutoryDataAction(input: unknown) {
  return exportPipeline(input);
}

// ── One person's withholding certificate (FR-PAY-35) ────────────────────────────────────────

const certificatePipeline = createAction({
  name: "payroll_statutory.withholding_certificate",
  stepUp: true,
  input: z.object({ personId: z.uuid(), entityId: z.uuid(), year: z.number().int().min(2000).max(2100) }),
  // The person's own certificate is theirs to take; anyone else needs the entity's compensation rights.
  authorize: (user, input) => user.person.id === input.personId || canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const certificate = await withholdingCertificate(user.principal, input, todayInVietnam());
    if (!certificate) throw new ActionError("statutory_export_not_available");
    const file = buildWithholdingCertificateData(certificate);
    return {
      data: { fileName: file.fileName, content: file.content, contentType: file.contentType, caveats: file.caveats },
      audit: {
        resource: { type: "payroll_withholding_certificate", id: `${input.personId}:${input.year}`, entityId: input.entityId },
        summary: `withholding certificate ${input.year}`,
        after: { year: input.year, own: user.person.id === input.personId },
      },
    };
  },
});

export async function withholdingCertificateAction(input: unknown) {
  return certificatePipeline(input);
}
