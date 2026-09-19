"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEntityAction } from "@/modules/platform/org/actions";

const FIELDS = [
  { name: "code", required: true },
  { name: "shortName", required: true },
  { name: "legalName", required: true },
  { name: "taxCode", required: false },
  { name: "wageRegion", required: false },
] as const;

export function CreateEntityForm() {
  const t = useTranslations("entities");
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    const input = Object.fromEntries([...formData.entries()].filter(([, value]) => value !== ""));
    startTransition(async () => {
      const result = await createEntityAction(input);
      if (result.ok) {
        setError(null);
        form.current?.reset();
        return;
      }
      const key = result.error === "failed" ? result.message : result.error;
      setError(t.has(`errors.${key}`) ? t(`errors.${key}`) : t("errors.generic"));
    });
  }

  return (
    <form ref={form} action={submit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("add")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {FIELDS.map((field) => (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={`entity-${field.name}`}>{t(field.name)}</Label>
            <Input
              id={`entity-${field.name}`}
              name={field.name}
              required={field.required}
              {...(field.name === "wageRegion" ? { type: "number", min: 1, max: 4 } : {})}
            />
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("creating") : t("create")}
        </Button>
      </div>
    </form>
  );
}
