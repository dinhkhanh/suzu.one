"use client";
// The phone's "+": a round ink button riding above the tab bar that opens a sheet of the four
// things people add most — a task, time on one, leave, a request. Each is one tap from any page.
// A desk has the palette (⌘K, "C") for the same.
import { CalendarRange, Clock, Plus, Receipt, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { openQuickCreate } from "@/components/shell/palette-bus";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type QuickAddLabels = {
  title: string;
  button: string;
  task: string;
  taskHint: string;
  time: string;
  timeHint: string;
  leave: string;
  leaveHint: string;
  request: string;
  requestHint: string;
  cancel: string;
};

const TILE = "press flex h-[5.5rem] flex-col items-start justify-between rounded-[14px] bg-muted p-3.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[1.375rem] [&>svg]:text-primary";

export function QuickAdd({ labels }: { labels: QuickAddLabels }) {
  const [open, setOpen] = useState(false);
  const tile = (title: string, hint: string) => (
    <span className="flex flex-col gap-0.5">
      <span className="text-[0.9375rem] font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        aria-label={labels.button}
        onClick={() => setOpen(true)}
        className="press fixed right-4 z-30 flex size-14 items-center justify-center rounded-[18px] bg-ink text-ink-foreground shadow-[0_8px_24px_oklch(0_0_0/28%)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.25rem)" }}
      >
        <Plus className="size-6" strokeWidth={2.25} aria-hidden />
      </button>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-md">
        <DialogTitle>{labels.title}</DialogTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            className={TILE}
            onClick={() => {
              setOpen(false);
              openQuickCreate();
            }}
          >
            <SquareCheck aria-hidden />
            {tile(labels.task, labels.taskHint)}
          </button>
          <Link href="/daily/time" className={TILE} onClick={() => setOpen(false)}>
            <Clock aria-hidden />
            {tile(labels.time, labels.timeHint)}
          </Link>
          <Link href="/leave/new" className={TILE} onClick={() => setOpen(false)}>
            <CalendarRange aria-hidden />
            {tile(labels.leave, labels.leaveHint)}
          </Link>
          <Link href="/requests/new" className={TILE} onClick={() => setOpen(false)}>
            <Receipt aria-hidden />
            {tile(labels.request, labels.requestHint)}
          </Link>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="press h-12 rounded-xl bg-muted text-[0.9375rem] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:hidden">
          {labels.cancel}
        </button>
      </DialogContent>
    </Dialog>
  );
}
