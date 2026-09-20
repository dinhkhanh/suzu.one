import "server-only";
import type { z } from "zod";
import { recordAudit, type AuditEntry } from "@/modules/platform/audit/service";
import { getCurrentUser, type CurrentUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "unauthenticated" | "forbidden" | "invalid" | "failed"; fieldErrors?: Record<string, string[]>; message?: string; /** What the form needs to explain a refusal, e.g. the likely duplicates of a new hire. */ details?: unknown };

type AuditDetails = Omit<AuditEntry, "actor" | "request" | "action">;

/** Thrown by services for expected, user-facing failures (e.g. "code already exists"). */
export class ActionError extends Error {
  constructor(
    message: string,
    /** Plain data for the form; never anything the caller may not see. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The one pipeline every mutation goes through (development plan §2.1):
 * parse → authenticate → authorize → run → audit. A step cannot be skipped because an
 * action cannot be defined without supplying it.
 */
export function createAction<Schema extends z.ZodType, Output>(definition: {
  /** Audit action name, e.g. "entity.create". */
  name: string;
  input: Schema;
  /**
   * Compensation and payroll actions (FR-PLT-06): refused with `step_up_required` unless the
   * session's holder proved who they are in the last few minutes. Checked before authorization,
   * so the answer says nothing about what the person may do.
   */
  stepUp?: boolean;
  authorize: (user: CurrentUser, input: z.output<Schema>) => boolean | Promise<boolean>;
  run: (context: { user: CurrentUser; input: z.output<Schema> }) => Promise<{ data: Output; audit: AuditDetails }>;
}) {
  return async (rawInput: unknown): Promise<ActionResult<Output>> => {
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      // Issue codes, not zod's English sentences: the form puts them into the reader's language.
      for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.code ?? "custom");
      return { ok: false, error: "invalid", fieldErrors };
    }

    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "unauthenticated" };

    const actor = { userId: user.userId, personId: user.person.id, email: user.email };

    // Recorded like a refusal: someone reaching a compensation action on a stale session is worth
    // seeing in the log, whether it is a forgotten tab or somebody else at the keyboard.
    if (definition.stepUp && !isStepUpFresh(user.reauthAt)) {
      await recordAudit({ action: `${definition.name}.step_up_required`, actor, request: user.request });
      return { ok: false, error: "failed", message: "step_up_required" };
    }

    if (!(await definition.authorize(user, parsed.data))) {
      await recordAudit({ action: `${definition.name}.denied`, actor, request: user.request });
      return { ok: false, error: "forbidden" };
    }

    try {
      const { data, audit } = await definition.run({ user, input: parsed.data });
      await recordAudit({ ...audit, action: definition.name, actor, request: user.request });
      return { ok: true, data };
    } catch (error) {
      if (error instanceof ActionError) return { ok: false, error: "failed", message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
      throw error;
    }
  };
}
