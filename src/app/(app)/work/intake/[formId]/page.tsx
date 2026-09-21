import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canSubmitIntake, findIntakeForm, type IntakeAudience, loadViewer, teamFacts } from "@/modules/work/service";
import { IntakeSubmitForm } from "@/modules/work/ui/intake-forms";

export const metadata: Metadata = { title: "Request" };

// One request form (FR-WRK-16). A retired form, or one of a team whose door is not open to this person, does not exist.
export default async function IntakeFormPage({ params }: PageProps<"/work/intake/[formId]">) {
  const user = await requireUser();
  const { formId } = await params;
  const found = /^[0-9a-f-]{36}$/.test(formId) ? await findIntakeForm(formId) : undefined;
  if (!found || !found.form.isActive || !found.team.isActive || !canSubmitIntake(await loadViewer(user), teamFacts(found.team), found.form.audience as IntakeAudience)) notFound();
  const t = await getTranslations("work.intake");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work/intake" className="underline">
            {t("title")}
          </Link>{" "}
          · {found.team.name}
        </p>
        <h1>{found.form.name}</h1>
        {found.form.description ? <p className="text-sm whitespace-pre-line text-muted-foreground">{found.form.description}</p> : null}
      </header>
      <IntakeSubmitForm formId={found.form.id} fields={found.form.fields} />
    </div>
  );
}
