"use client";
// A row of today's plan (FR-PJM-20, 37): the round check at its head marks the task done in one
// tap. The move is the work module's own (`updateTaskAction`, handed in by the page, as the quick
// add takes `createTask`). A state the team guards with a hand-off package refuses the shortcut and
// says so: the state control beside it opens the hand-off sheet (work/ui/task-state-select.tsx).
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (input: unknown) => Promise<ActionResult<unknown>>;

export function DoneCheck({ taskId, doneStateId, done, action }: { taskId: string; /** The team's "done" state; without one the check only shows. */ doneStateId: string | null; done: boolean; action: Action }) {
  const t = useTranslations("daily.today");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const mark = () =>
    startTransition(async () => {
      const result = await action({ taskId, stateId: doneStateId });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) router.refresh();
    });
  return (
    <>
      <button
        type="button"
        aria-label={done ? t("doneAlready") : t("markDone")}
        aria-pressed={done}
        disabled={done || pending || !doneStateId}
        onClick={mark}
        className={cn(
          "press flex size-6 shrink-0 items-center justify-center rounded-full border outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5",
          done ? "border-success/40 bg-success/12 text-success" : "border-input bg-background text-transparent hover:border-foreground/50 hover:text-faint disabled:opacity-60"
        )}
      >
        <Check aria-hidden strokeWidth={2.5} />
      </button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}
