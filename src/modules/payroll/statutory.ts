// The statutory snapshot of a payroll period (FR-PLT-38, FR-PAY-20): every legal figure the
// engine needs as it stood on the period's last day, with the version id of each — stored with a
// run's results so a payslip can be explained and reproduced.
import "server-only";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import type { ParameterKey } from "@/modules/platform/statutory/catalogue";
import { getParameterSnapshot } from "@/modules/platform/statutory/service";
import { STATUTORY_KEYS, type StatutoryParams } from "./engine/types";

export type LoadedStatutoryParams = {
  params: StatutoryParams;
  /** statutory key → id of the version used. */
  versions: Record<string, string>;
  /** Keys still marked unverified: shown as a warning on every run until the chief accountant confirms them. */
  unverified: string[];
};

export async function loadStatutoryParams(periodEnd: IsoDate, executor: Tx | ReturnType<typeof db> = db()): Promise<LoadedStatutoryParams> {
  const names = Object.keys(STATUTORY_KEYS) as (keyof StatutoryParams)[];
  const snapshot = await getParameterSnapshot(names.map((name) => STATUTORY_KEYS[name]) as ParameterKey[], periodEnd, executor);
  const params: Record<string, unknown> = {};
  const versions: Record<string, string> = {};
  const unverified: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const key = STATUTORY_KEYS[name];
    const version = snapshot[key];
    if (!version) {
      missing.push(key);
      continue;
    }
    params[name] = version.value;
    versions[key] = version.id;
    if (!version.isVerified) unverified.push(key);
  }
  // Payroll never guesses a legal figure: a gap stops the run and names the parameter.
  if (missing.length) throw new ActionError("statutory_parameter_missing", { keys: missing, on: periodEnd });
  return { params: params as StatutoryParams, versions, unverified };
}
