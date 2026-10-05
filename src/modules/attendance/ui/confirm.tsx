"use client";
// Asking before something that cannot be taken back: in the house Dialog — a sheet on a phone, a
// card on a desk — that names what will happen, never the browser's own confirm(), which a phone
// shows as a bare system alert.
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ConfirmDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; question: string; detail?: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean; pending?: boolean };

export function ConfirmDialog({ open, onOpenChange, question, detail, confirmLabel, onConfirm, destructive = false, pending = false }: ConfirmDialogProps) {
  const t = useTranslations("attendance.dialog");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{question}</DialogTitle>
          {detail ? <DialogDescription>{detail}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Puts the question between a form and its action: the first submit opens the dialog, "yes"
 * submits the form again — with the same button, so a form that offers several outcomes still
 * posts the one that was pressed. Without a question the form submits at once.
 */
export function useConfirmedSubmit(onSubmit: (event: FormEvent<HTMLFormElement>) => void, ask: { question?: string; confirmLabel: string; destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement | null>(null);
  const submitter = useRef<HTMLElement | null>(null);
  const confirmed = useRef(false);

  function handle(event: FormEvent<HTMLFormElement>) {
    if (!ask.question || confirmed.current) {
      confirmed.current = false;
      return onSubmit(event);
    }
    event.preventDefault();
    form.current = event.currentTarget;
    submitter.current = (event.nativeEvent as SubmitEvent).submitter;
    setOpen(true);
  }

  const dialog = ask.question ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      question={ask.question}
      confirmLabel={ask.confirmLabel}
      destructive={ask.destructive}
      onConfirm={() => {
        confirmed.current = true;
        setOpen(false);
        form.current?.requestSubmit(submitter.current ?? undefined);
      }}
    />
  ) : null;

  return { onSubmit: handle, dialog };
}
