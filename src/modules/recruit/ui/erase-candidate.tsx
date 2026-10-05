"use client";
// Erasing a candidate on their request (PDPL; NFR-PRV-04). One button and one question, because it
// cannot be undone: the record is emptied everywhere it was used and its files leave storage at once.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { eraseCandidateAction } from "../actions";

export function EraseCandidateButton({ candidateId }: { candidateId: string }) {
  const t = useTranslations("recruit.erase");
  const tErrors = useTranslations("recruit.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setErrorKey(null);
          setOpen(true);
        }}
      >
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>
          {errorKey ? <Alert variant="destructive">{tErrors.has(errorKey as never) ? tErrors(errorKey as never) : tErrors("generic")}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await eraseCandidateAction({ candidateId });
                  if (result.ok) {
                    setOpen(false);
                    router.refresh();
                    return;
                  }
                  setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
                })
              }
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
