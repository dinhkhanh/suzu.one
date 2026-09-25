"use client";
// Copies an open opening's public advertisement URL, so a recruiter can paste it into a post or a
// message. The URL is built on the server from the public domain (PUBLIC_SITE_URL) and the opaque slug.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyCareersLink({ url }: { url: string }) {
  const t = useTranslations("recruit.actions");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      title={url}
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? t("careersLinkCopied") : t("copyCareersLink")}
    </Button>
  );
}
