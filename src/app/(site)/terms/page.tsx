import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type LegalDocumentContent, LegalDocument } from "@/components/site/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");
  return { title: t("title"), description: t("description") };
}

export default async function TermsPage() {
  const t = await getTranslations("legal");
  return <LegalDocument content={t.raw("terms") as LegalDocumentContent} />;
}
