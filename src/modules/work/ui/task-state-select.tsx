"use client";
// A task's workflow state as a native select, for quick moves (Today, FR-PJM-37): tap, pick — the
// change is saved at once. A move the team guards with a hand-off package opens the hand-off sheet
// right there (FR-PJM-40); a "Published" state without its post's URL says so (FR-PJM-54).
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { updateTaskAction } from "../actions";
import { DeliveryError, errorKeyOf } from "./delivery-shared";
import { useHandoffGate } from "./handoff";

type State = { id: string; name: string; category: string };

export function TaskStateSelect({ taskId, stateId, states }: { taskId: string; stateId: string; states: State[] }) {
  const t = useTranslations("work.task");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { intercept, sheet } = useHandoffGate();
  const change = (next: string) =>
    startTransition(async () => {
      const result = await updateTaskAction({ taskId, stateId: next });
      // The hand-off gate's refusal is no error: the sheet opens instead.
      setErrorKey(result.ok || intercept(result) ? null : errorKeyOf(result));
      if (result.ok) router.refresh();
    });
  return (
    <div className="flex flex-col gap-1">
      <Select aria-label={t("changeState")} value={stateId} disabled={pending} onChange={(event) => change(event.target.value)} className="h-8 w-auto max-w-40 text-xs">
        {states.map((state) => (
          <option key={state.id} value={state.id}>
            {state.name}
          </option>
        ))}
      </Select>
      <DeliveryError errorKey={errorKey} />
      {sheet}
    </div>
  );
}
