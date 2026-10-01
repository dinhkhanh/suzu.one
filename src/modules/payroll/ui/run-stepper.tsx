// Where a run is on its way from the month's facts to the money leaving: five stages, the ones
// behind it ticked, the one it is on in the accent, the ones ahead outlined. Pure presentation
// over the run's status (SRS D17); the steps a person may take are the forms beside it.
import { CheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "cn";
import type { RunStatus } from "../lifecycle";

export const RUN_STAGES = ["collect", "compute", "review", "approve", "pay"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/** How many stages a status has put behind it. */
const DONE: Record<RunStatus, number> = { draft: 0, calculated: 1, proposed: 2, approved: 3, payment_prepared: 4, paid: 5, locked: 5, cancelled: 0 };

export function stageStates(status: RunStatus): Record<RunStage, "done" | "current" | "next"> {
  const done = DONE[status];
  const cancelled = status === "cancelled";
  return Object.fromEntries(RUN_STAGES.map((stage, index) => [stage, index < done ? "done" : index === done && !cancelled ? "current" : "next"])) as Record<RunStage, "done" | "current" | "next">;
}

export async function RunStepper({ status }: { status: RunStatus }) {
  const t = await getTranslations("payroll.runs.stages");
  const states = stageStates(status);
  return (
    <ol className="grid grid-cols-5 gap-1 md:gap-2" aria-label={t("label")}>
      {RUN_STAGES.map((stage, index) => {
        const state = states[stage];
        return (
          <li key={stage} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <span className="flex w-full items-center">
              <span aria-hidden className={cn("h-px flex-1", index === 0 ? "bg-transparent" : state === "next" ? "bg-border" : "bg-success/40")} />
              <span
                className={cn(
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold",
                  state === "done" && "border-success bg-success text-white",
                  state === "current" && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15",
                  state === "next" && "border-border bg-background text-faint"
                )}
              >
                {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span aria-hidden className={cn("h-px flex-1", index === RUN_STAGES.length - 1 ? "bg-transparent" : state === "done" ? "bg-success/40" : "bg-border")} />
            </span>
            <span className={cn("truncate text-[0.6875rem] font-medium md:text-xs", state === "current" ? "text-foreground" : state === "done" ? "text-muted-foreground" : "text-faint")}>{t(stage)}</span>
          </li>
        );
      })}
    </ol>
  );
}
