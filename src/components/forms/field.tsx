"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}

/** Shows an action's failure using `<namespace>.<errorKey>`, falling back to `<namespace>.generic`. */
export function FormError({ namespace, errorKey }: { namespace: string; errorKey: string | null }) {
  const t = useTranslations(namespace);
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(errorKey) ? t(errorKey) : t("generic")}
    </p>
  );
}
