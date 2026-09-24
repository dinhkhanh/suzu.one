import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type LegalDocumentContent, LegalDocument } from "@/components/site/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return { title: t("title"), description: t("description") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  return <LegalDocument content={t.raw("privacy") as LegalDocumentContent} />;
}
