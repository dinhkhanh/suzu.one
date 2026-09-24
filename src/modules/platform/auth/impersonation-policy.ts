// Seeing the app as somebody else (FR-PLT-40): the pure rules. No I/O. Who may borrow whose
// identity is `canImpersonate` in rbac/policy.ts; this file knows how long a borrowed session lasts
// and what proof of identity travels with it.
import { readableTier, type ImpersonationTarget, type Principal } from "../rbac/policy";

/** A borrowed identity is a working session, not a standing arrangement: it ends by itself. */
export const IMPERSONATION_MAX_HOURS = 8;

/** Is a session that started looking through someone's eyes at `since` still allowed to? */
export function isImpersonationLive(since: Date | null | undefined, now: Date = new Date(), maxHours: number = IMPERSONATION_MAX_HOURS): boolean {
  if (!since || Number.isNaN(since.getTime())) return false;
  const age = now.getTime() - since.getTime();
  // A start in the future is a broken clock or a forged row, not a live session.
  return age >= -60_000 && age <= maxHours * 3_600_000;
}

/**
 * The step-up proof a borrowed session carries. The target's own compensation opens to "themselves"
 * without a grant, so the proof travels only where the impersonator's own grants already read the
 * target at that tier (the owner, C&B over the entity); a support person sees no payslip.
 */
export function impersonatedReauthAt(impersonator: Principal, target: ImpersonationTarget, reauthAt: Date | null): Date | null {
  return readableTier(impersonator, target) === "compensation" ? reauthAt : null;
}
