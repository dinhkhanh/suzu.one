import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Also what people see for pages they have no access to: the app does not reveal what exists.
export default async function AppNotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="flex max-w-md flex-col gap-3 py-16">
      <h1>{t("notFoundTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
      <div>
        <Link href="/home" className={buttonVariants()}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
