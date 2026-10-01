"use client";
// "Góp ý" in the header of every page: one click from anywhere to a short form, with the page
// it was pressed on attached. After sending, a thank-you and the way to follow the answer.
import { CircleCheck, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackForm } from "./feedback-form";
import { cn } from "@/lib/utils";

export function FeedbackButton() {
  const t = useTranslations("feedback");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The page is taken when the dialog opens, not as the reader moves on afterwards.
  const [pagePath, setPagePath] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  function show() {
    setPagePath(pathname);
    setSentId(null);
    setOpen(true);
  }

  return (
    <>
      {/* The icon alone on a phone, the icon and its word on a desk. */}
      <Button variant="outline" size="icon-sm" className="sm:hidden" onClick={show} aria-haspopup="dialog" aria-label={t("button.label")} title={t("button.title")}>
        <MessageSquarePlus aria-hidden />
      </Button>
      <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={show} aria-haspopup="dialog" title={t("button.title")}>
        <MessageSquarePlus aria-hidden />
        {t("button.label")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="pr-8">
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.help")}</DialogDescription>
          </DialogHeader>
          {sentId ? (
            <div className="flex flex-col items-start gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CircleCheck className="size-5 text-success" aria-hidden />
                {t("dialog.thanks")}
              </p>
              <p className="text-sm text-muted-foreground">{t("dialog.follow")}</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/feedback/${sentId}`} onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
