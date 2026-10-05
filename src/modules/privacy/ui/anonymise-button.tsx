"use client";
// HR's confirmation of one anonymisation (NFR-PRV-04): asked in the house dialog, which says what
// goes and what the law keeps, because nothing brings it back.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { anonymisePersonAction } from "../actions";

export function AnonymiseButton({ personId, name }: { personId: string; name: string }) {
  const t = useTranslations("privacy.admin");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      const result = await anonymisePersonAction({ personId });
      if (!result.ok) return setError(result.error === "failed" && result.message && t.has(`errors.${result.message}`) ? t(`errors.${result.message}` as "errors.generic") : t("errors.generic"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => (setError(null), setOpen(true))}>
        {t("anonymise")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle", { name })}</DialogTitle>
            <DialogDescription>{t("confirmIntro")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">{t("goes")}</p>
            <p className="text-muted-foreground">{t("goesList")}</p>
            <p className="font-medium">{t("stays")}</p>
            <p className="text-muted-foreground">{t("staysList")}</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
              {t("anonymise")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
