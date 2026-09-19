"use client";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext } from "react";
import { Label } from "@/components/ui/label";

const FieldErrorsContext = createContext<Record<string, string[]>>({});

/** Wrap a form's fields in this with `fieldErrors` from `useActionForm`: each <Field> then shows what the server refused about it. */
export function FieldErrors({ value, children }: { value: Record<string, string[]>; children: ReactNode }) {
  return <FieldErrorsContext.Provider value={value}>{children}</FieldErrorsContext.Provider>;
}

export function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  const t = useTranslations("forms.fieldErrors");
  const [code] = useContext(FieldErrorsContext)[name] ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {code ? (
        <p role="alert" className="text-xs text-destructive">
          {t.has(code) ? t(code) : t("invalid")}
        </p>
      ) : null}
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
