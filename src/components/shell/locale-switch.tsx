"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/i18n/actions";
import { LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";

const LABELS: Record<(typeof LOCALES)[number], string> = { vi: "Tiếng Việt", en: "English" };

export function LocaleSwitch() {
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1 text-xs" aria-busy={pending}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={locale === current}
          className={cn(
            "rounded-md px-2 py-1 text-muted-foreground hover:text-foreground",
            locale === current && "bg-muted font-medium text-foreground",
          )}
          onClick={() =>
            startTransition(async () => {
              await setLocaleAction(locale);
              router.refresh();
            })
          }
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
