"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/modules/platform/auth/preference-actions";
import { type Theme, THEMES, themeAttribute } from "@/theme/config";

const ICONS: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/**
 * Light, dark, or whatever the device says — three icons, the way the language switch is two
 * codes. The stylesheet reads the choice off `<html data-theme>`, which the root layout writes from
 * the cookie; the click sets that attribute at once so the page turns before the round trip ends.
 * `compact` is the sidebar's version, drawn to sit beside the language switch in its footer.
 */
export function ThemeSwitch({ theme, compact = false }: { theme: Theme; compact?: boolean }) {
  const t = useTranslations("theme");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(theme);

  return (
    <div
      role="group"
      aria-label={t("label")}
      aria-busy={pending}
      className={cn("flex rounded-lg border border-border p-0.5 text-xs", !compact && "gap-1")}
    >
      {THEMES.map((option) => {
        const Icon = ICONS[option];
        return (
          <button
            key={option}
            type="button"
            aria-pressed={option === current}
            aria-label={t(option)}
            title={t(option)}
            className={cn(
              "flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
              compact ? "size-6" : "size-7",
              option === current && "bg-muted text-foreground",
            )}
            onClick={() =>
              startTransition(async () => {
                setCurrent(option);
                applyTheme(option);
                await setThemeAction(option);
                router.refresh();
              })
            }
          >
            <Icon className={compact ? "size-3.5" : "size-4"} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Mirrors what the root layout renders, so the switch takes effect before the server answers. */
function applyTheme(theme: Theme) {
  const value = themeAttribute(theme);
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}
