"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/modules/platform/auth/preference-actions";
import { LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";

const LABELS: Record<(typeof LOCALES)[number], string> = { vi: "Tiếng Việt", en: "English" };

/** `compact` is the sidebar's version: two-letter codes, so the footer row fits beside sign-out. */
export function LocaleSwitch({ compact = false }: { compact?: boolean } = {}) {
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn("flex text-xs", compact ? "rounded-lg border border-border p-0.5" : "gap-1")} aria-busy={pending}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={locale === current}
          aria-label={compact ? LABELS[locale] : undefined}
          className={cn(
            "rounded-md px-2 py-1 text-muted-foreground hover:text-foreground",
            compact && "px-1.5 py-0.5 font-medium",
            locale === current && "bg-muted font-medium text-foreground",
          )}
          onClick={() =>
            startTransition(async () => {
              await setLocaleAction(locale);
              router.refresh();
            })
          }
        >
          {compact ? locale.toUpperCase() : LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
