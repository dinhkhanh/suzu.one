"use client";
// "Put the waiting claims into a run" (FR-REQ-03). The sweep is idempotent, so pressing it twice
// is harmless — the second press simply finds nothing waiting.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { sweepExpenseClaimsAction } from "../expense-actions";

export function SweepClaimsButton({ label }: { label: string }) {
  const t = useTranslations("requests.expense");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ posted: number; stillWaiting: number } | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {result ? <span className="text-xs text-muted-foreground">{t("sweptResult", { posted: result.posted, waiting: result.stillWaiting })}</span> : null}
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {t("sweepFailed")}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const answer = await sweepExpenseClaimsAction({});
            if (!answer.ok) return setFailed(true);
            setResult(answer.data as { posted: number; stillWaiting: number });
            router.refresh();
          })
        }
      >
        {label}
      </Button>
    </div>
  );
}
