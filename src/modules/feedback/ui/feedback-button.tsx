"use client";
// "Góp ý" in the header of every page: one click from anywhere to a short form, with the page
// it was pressed on attached. After sending, a thank-you and the way to follow the answer.
import { CircleCheck, MessageSquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FeedbackForm } from "./feedback-form";

export function FeedbackButton() {
  const t = useTranslations("feedback");
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // The page is taken when the dialog opens, not as the reader moves on afterwards.
  const [pagePath, setPagePath] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  function show() {
    setPagePath(pathname);
    setSentId(null);
    setOpen(true);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={show} aria-haspopup="dialog" title={t("button.title")}>
        <MessageSquarePlus aria-hidden />
        <span className="hidden sm:inline">{t("button.label")}</span>
        <span className="sr-only sm:hidden">{t("button.label")}</span>
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="feedback-title"
        onClose={() => setOpen(false)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-0 text-foreground shadow-[0_24px_60px_-20px_oklch(0_0_0/35%)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="feedback-title" className="text-lg font-semibold">
                {t("dialog.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("dialog.help")}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={t("dialog.close")} onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          {sentId ? (
            <div className="flex flex-col items-start gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CircleCheck className="size-5 text-emerald-600" aria-hidden />
                {t("dialog.thanks")}
              </p>
              <p className="text-sm text-muted-foreground">{t("dialog.follow")}</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/feedback/${sentId}`} onClick={() => setOpen(false)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("dialog.view")}
                </Link>
                <Button size="sm" variant="ghost" onClick={() => setSentId(null)}>
                  {t("dialog.another")}
                </Button>
              </div>
            </div>
          ) : open ? (
            <FeedbackForm pagePath={pagePath} onSent={setSentId} autoFocus />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
