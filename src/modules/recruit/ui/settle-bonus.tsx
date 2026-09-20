"use client";
// Marking a referral bonus settled (FR-REC-10). No amount is typed here and none is stored: the
// note says what was done, payroll says what it cost.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settleReferralBonusAction } from "../referral-actions";

export function SettleBonusButton({ referralId }: { referralId: string }) {
  const t = useTranslations("recruit.referral");
  const tErrors = useTranslations("recruit.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (!open)
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("settle")}
      </Button>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("settleNote")} maxLength={500} className="w-56" />
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await settleReferralBonusAction({ referralId, note });
            if (result.ok) {
              setOpen(false);
              router.refresh();
              return;
            }
            setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
          })
        }
      >
        {t("settleConfirm")}
      </Button>
      {errorKey ? <span className="text-xs text-destructive">{tErrors.has(errorKey as never) ? tErrors(errorKey as never) : tErrors("generic")}</span> : null}
    </div>
  );
}
