// Which component definitions apply to an entity on a day. Pure.
import { isRoundingRule } from "./rounding";
import { checkFormula, type FormulaError } from "./formula";
import { allowedFormulaVariables } from "./formula/variables";

export type ComponentVersion = { id: string; entityId: string | null; code: string; status: string; validFrom: string; validTo: string | null; sortOrder: number };

/**
 * The approved versions in force on `date`: the entity's own version of a code replaces the
 * group's (entity_id null). Sorted the way payslips list them.
 */
export function pickCatalogue<Row extends ComponentVersion>(rows: readonly Row[], entityId: string | null, date: string): Row[] {
  const inForce = rows.filter((row) => row.status === "approved" && row.validFrom <= date && (row.validTo === null || row.validTo >= date) && (row.entityId === null || row.entityId === entityId));
  const byCode = new Map<string, Row>();
  for (const row of inForce) {
    const chosen = byCode.get(row.code);
    if (!chosen || (chosen.entityId === null && row.entityId !== null)) byCode.set(row.code, row);
  }
  return [...byCode.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export type ComponentDraft = { code: string; source: "structure" | "formula" | "engine" | "input"; formula: string | null; taxTreatment: "taxable" | "exempt" | "exempt_up_to_cap"; exemptCap: number | null; roundingRule: string };

export type ComponentProblem = { code: "formula_required" | "formula_not_allowed" | "formula_invalid" | "formula_reads_itself" | "cap_required" | "cap_not_allowed" | "rounding_rule_unknown"; formulaError?: FormulaError };

/** Save-time validation of a proposed component against the catalogue it will live in. */
export function checkComponentDraft(draft: ComponentDraft, otherCodes: Iterable<string>): ComponentProblem | null {
  if (!isRoundingRule(draft.roundingRule)) return { code: "rounding_rule_unknown" };
  if ((draft.taxTreatment === "exempt_up_to_cap") !== (draft.exemptCap !== null)) return { code: draft.exemptCap === null ? "cap_required" : "cap_not_allowed" };
  if (draft.source !== "formula") return draft.formula === null ? null : { code: "formula_not_allowed" };
  if (!draft.formula) return { code: "formula_required" };
  const others = [...otherCodes].filter((code) => code !== draft.code);
  const checked = checkFormula(draft.formula, allowedFormulaVariables(others));
  if (checked.ok) return null;
  // A formula naming its own component would read a value that does not exist yet.
  const self = checkFormula(draft.formula, allowedFormulaVariables([...others, draft.code]));
  return self.ok ? { code: "formula_reads_itself" } : { code: "formula_invalid", formulaError: checked.error };
}
