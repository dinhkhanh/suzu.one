import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Home" };

const ROADMAP = [
  { key: "attendance", phase: 2 },
  { key: "leave", phase: 2 },
  { key: "work", phase: 3 },
  { key: "ops", phase: 3 },
  { key: "kb", phase: 4 },
  { key: "payroll", phase: 5 },
] as const;

export default async function HomePage() {
  const user = await requireUser();
  const t = await getTranslations();
  const givenName = user.person.fullName.trim().split(/\s+/).at(-1) ?? user.person.fullName;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("home.greeting", { name: givenName })}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("home.roles")}</h2>
        <div className="flex flex-wrap gap-2">
          {user.principal.grants.length === 0 ? (
            <Badge variant="secondary">{t("home.noRoles")}</Badge>
          ) : (
            user.principal.grants.map((grant, index) => (
              <Badge key={index} variant="secondary">
                {t(`roles.${grant.role}`)}
                {grant.scope.type === "group" ? ` · ${t("home.scopeGroup")}` : ""}
              </Badge>
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("home.roadmap")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map((item) => (
            <Card key={item.key}>
              <CardHeader>
                <CardTitle className="text-base">{t(`nav.${item.key}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">{t("home.phase", { n: item.phase })}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
