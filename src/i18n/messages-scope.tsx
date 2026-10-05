"use client";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { mergeMessages } from "./surfaces";

/**
 * Adds a section's words to the ones the page already has. A nested provider would *replace* the
 * messages above it, and the shell's (the theme switch, the selects, the command palette) must stay
 * reachable inside every section, so the two are merged; locale, time zone and formats are the
 * parent's.
 */
export function MessagesScope({ messages, children }: { messages: Record<string, unknown>; children: ReactNode }) {
  const locale = useLocale();
  const parent = useMessages() as Record<string, unknown>;
  const merged = useMemo(() => mergeMessages(parent, messages), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged as Parameters<typeof NextIntlClientProvider>[0]["messages"]}>
      {children}
    </NextIntlClientProvider>
  );
}
