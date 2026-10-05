"use client";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies a colour code on the public guideline, and says so for a moment. */
export function CopyButton({ value }: { value: string }) {
  const t = useTranslations("brands.public");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? t("copied") : t("copy", { value })}
      title={copied ? t("copied") : t("copy", { value })}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // A browser that refuses the clipboard leaves the code selectable as text.
        }
      }}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}
