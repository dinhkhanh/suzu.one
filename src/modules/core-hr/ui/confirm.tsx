"use client";
// The second thought before something that is hard to take back — a termination, a deletion — on
// shadcn's alert dialog rather than the browser's `confirm()`, which a phone draws as a bare system
// box with the site's address in it. The trigger is the button the screen would have drawn anyway;
// pressing it asks, and only "confirm" runs the action.
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ButtonProps = Pick<ComponentProps<typeof Button>, "variant" | "size" | "disabled" | "className">;

export function ConfirmButton({
  label,
  question,
  confirmLabel,
  destructive,
  onConfirm,
  beforeOpen,
  ...button
}: ButtonProps & {
  label: string;
  question: string;
  /** Defaults to the trigger's own label. */
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** false keeps the dialog shut — a form that is not filled in yet says so first (`reportValidity`). */
  beforeOpen?: () => boolean;
}) {
  const t = useTranslations("controls");
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button type="button" {...button} onClick={() => (beforeOpen?.() === false ? undefined : setOpen(true))}>
        {label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmLabel ?? label}</AlertDialogTitle>
          <AlertDialogDescription>{question}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("confirmNo")}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel ?? label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
