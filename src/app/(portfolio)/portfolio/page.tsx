import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

type Service = { title: string; body: string };

// The company's front door on the public domain. Placeholder copy until the real portfolio lands:
// what the company does, and the way in for candidates.
export default async function PortfolioPage() {
  const t = await getTranslations("portfolio");
  const services = t.raw("services") as Service[];

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">{t("headline")}</h1>
        <p className="text-base text-muted-foreground">{t("lead")}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("servicesTitle")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <li key={service.title} className="flex flex-col gap-1 rounded-xl border p-4">
              <p className="font-medium">{service.title}</p>
              <p className="text-sm text-muted-foreground">{service.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("careersTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("careersBody")}</p>
        <Link href="/careers" className={buttonVariants({ variant: "outline", className: "self-start" })}>
          {t("careersLink")}
        </Link>
      </section>
    </div>
  );
}
