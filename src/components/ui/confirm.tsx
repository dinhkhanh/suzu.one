"use client";
// The second thought before something that is hard to take back — a deletion, a withdrawal, a
// termination — asked one way everywhere: in the house Dialog (a sheet on a phone, a card on a
// desk) with the question as its title, what will happen under it, and "go back" beside the
// action. Never the browser's own confirm(), which a phone draws as a bare system box with the
// site's address in it.
import { useTranslations } from "next-intl";
import { type ComponentProps, type FormEvent, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ConfirmDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; question: string; detail?: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean; pending?: boolean };

/** The question itself, opened and shut by its owner. */
export function ConfirmDialog({ open, onOpenChange, question, detail, confirmLabel, onConfirm, destructive = false, pending = false }: ConfirmDialogProps) {
  const t = useTranslations("controls");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{question}</DialogTitle>
          {detail ? <DialogDescription>{detail}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("confirmNo")}
          </Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ButtonProps = Pick<ComponentProps<typeof Button>, "variant" | "size" | "disabled" | "className">;

/**
 * The button the screen would have drawn anyway; pressing it asks, and only the answer "yes" runs
 * `onConfirm`. The dialog's action repeats the button's label unless `confirmLabel` says otherwise.
 */
export function ConfirmButton({
  label,
  children,
  question,
  detail,
  confirmLabel,
  destructive,
  onConfirm,
  beforeOpen,
  ...button
}: ButtonProps & {
  label: string;
  /** What the button shows, when it is more than its label (an icon beside it). */
  children?: ReactNode;
  question: string;
  detail?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** false keeps the dialog shut — a form that is not filled in yet says so first (`reportValidity`). */
  beforeOpen?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" {...button} onClick={() => (beforeOpen?.() === false ? undefined : setOpen(true))}>
        {children ?? label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        question={question}
        detail={detail}
        confirmLabel={confirmLabel ?? label}
        destructive={destructive}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}

/**
 * Puts the question between a form and its action: the first submit opens the dialog, "yes"
 * submits the form again — with the same button, so a form that offers several outcomes still
 * posts the one that was pressed. Without a question the form submits at once.
 */
export function useConfirmedSubmit(onSubmit: (event: FormEvent<HTMLFormElement>) => void, ask: { question?: string | null; detail?: string; confirmLabel: string; destructive?: boolean }) {
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
      detail={ask.detail}
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
