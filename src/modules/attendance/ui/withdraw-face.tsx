"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { withdrawFaceConsentAction } from "../kiosk-actions";
import { ConfirmDialog } from "@/components/ui/confirm";

/** Withdrawing one's consent to face check-in: asked once in a sheet, then the face data is gone. */
export function WithdrawFaceConsentButton() {
  const t = useTranslations("attendance.myFace");
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const withdraw = () =>
    start(async () => {
      const result = await withdrawFaceConsentAction({});
      setAsking(false);
      setFailed(!result.ok);
      if (result.ok) router.refresh();
    });
  return (
    <>
      <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => setAsking(true)}>
        {t("withdraw")}
      </Button>
      <ConfirmDialog open={asking} onOpenChange={setAsking} question={t("withdrawConfirm")} detail={t("withdrawDetail")} confirmLabel={t("withdraw")} destructive pending={pending} onConfirm={withdraw} />
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t("failed")}
        </p>
      ) : null}
    </>
  );
}
