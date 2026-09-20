// Phase 8 demo data: the **year-end bonus scheme** (FR-PAY-21, SRS Q14), called from seed-demo.ts.
//
// Only the configuration is written here. The run itself — building it, simulating the group's
// cost, the owner's adjustment, the CEO's signature and the off-cycle payroll run that pays it —
// goes through the real use-cases, which `tsx` cannot load (`server-only`). So it is a
// development-only job the dev server runs: `pnpm dev`, then `pnpm db:seed:demo:bonus`.
//
// What is left behind: one approved, group-wide scheme version in force from 1 January 2026 —
// one month's salary at "meets expectations" and a full year of service, 1,5× at "outstanding",
// nothing below expectations, the whole thing moved ±20 % by the entity's OKR year, capped at
// three months and rounded to the nearest 1.000 đ. All of it the owner's to change.
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { bonusScheme, person } from "../src/lib/db/schema";
import { DEFAULT_BONUS_SCHEME } from "../src/modules/payroll/enums";

type Db = ReturnType<typeof drizzle>;

const HR = "Nguyễn Thu Hà";
const OWNER = "Trần Đình Khánh";
const YEAR = 2026;

export async function seedBonusScheme(db: Db): Promise<string> {
  const [already] = await db.select({ id: bonusScheme.id }).from(bonusScheme).limit(1);
  if (already) return "0 bonus scheme versions (already seeded)";

  const people = await db.select({ id: person.id, fullName: person.fullName }).from(person).where(eq(person.status, "active"));
  const byName = new Map(people.map((row) => [row.fullName, row.id]));
  const hr = byName.get(HR);
  const owner = byName.get(OWNER) ?? hr;
  if (!hr || !owner) return "0 bonus scheme versions (run the people seed first)";

  await db.insert(bonusScheme).values({
    entityId: null,
    value: DEFAULT_BONUS_SCHEME,
    validFrom: `${YEAR}-01-01`,
    status: "approved",
    note: "Phiên bản đầu (SRS Q14): lương 1 tháng khi đạt và đủ 12 tháng làm việc, 1,5× khi xuất sắc, 0 khi chưa đạt; hệ số OKR công ty ±20 %; trần 3 tháng; làm tròn 1.000 đ.",
    proposedByPersonId: hr,
    decidedByPersonId: owner,
    decidedAt: new Date(`${YEAR}-11-25T02:00:00Z`),
  });

  return `1 approved ${YEAR} bonus scheme version (run \`pnpm db:seed:demo:bonus\` with the dev server up for the run itself)`;
}
