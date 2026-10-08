"use client";
// "Hỏi SuZu" in the header of every page (Phase 13 R5, FR-AGT-01): the assistant in a sheet over
// the page — a bottom sheet on a phone — that knows which record is on screen (FR-AGT-02).
//
// What every page pays for it is this button. The chat itself is loaded the first time the sheet
// opens (`import()`), and its words with it (`/api/assistant/words`, `LAZY_SURFACES` in
// scripts/i18n-route-namespaces.ts). Once open, the sheet keeps its conversation while it is closed
// and while the person moves between pages, until they start a new one.
import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const SheetBody = dynamic(() => import("./agent-sheet-body").then((loaded) => loaded.AgentSheetBody), { ssr: false });

export function AgentSheet() {
  const t = useTranslations("assistantSheet");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Nothing is loaded until the first open; after it, the body stays.
  const [started, setStarted] = useState(false);
  // On the assistant's own page the page is the chat.
  if (pathname === "/assistant" || pathname.startsWith("/assistant/")) return null;

  const show = () => {
    setStarted(true);
    setOpen(true);
  };

  return (
    <>
      {/* The icon alone on a phone, the icon and its word on a desk. */}
      <Button variant="outline" size="icon-sm" className="sm:hidden" onClick={show} aria-haspopup="dialog" aria-label={t("button")} title={t("hint")}>
        <SparklesIcon aria-hidden />
      </Button>
      <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={show} aria-haspopup="dialog" title={t("hint")}>
        <SparklesIcon aria-hidden />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent keepMounted className="flex h-[85dvh] flex-col gap-3 overflow-hidden sm:h-[min(46rem,calc(100dvh-4rem))] sm:max-w-xl">
          <DialogTitle className="pr-8">{t("title")}</DialogTitle>
          {started ? <SheetBody pathname={pathname} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
