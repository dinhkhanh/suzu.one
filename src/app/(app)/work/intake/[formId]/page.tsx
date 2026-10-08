import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { canSubmitIntake, findIntakeForm, type IntakeAudience, loadViewer, teamFacts } from "@/modules/work/service";
import { IntakeSubmitForm } from "@/modules/work/ui/intake-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("request");

// One request form (FR-WRK-16). A retired form, or one of a team whose door is not open to this person, does not exist.
export default async function IntakeFormPage({ params }: PageProps<"/work/intake/[formId]">) {
  const user = await requireUser();
  const { formId } = await params;
  const found = /^[0-9a-f-]{36}$/.test(formId) ? await findIntakeForm(formId) : undefined;
  if (!found || !found.form.isActive || !found.team.isActive || !canSubmitIntake(await loadViewer(user), teamFacts(found.team), found.form.audience as IntakeAudience)) notFound();
  const t = await getTranslations("work.intake");

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <Link href="/work/intake" className="hover:underline">
              {t("title")}
            </Link>{" "}
            · {found.team.name}
          </span>
        }
        title={found.form.name}
      >
        <RichText text={found.form.description} className="max-w-prose text-sm text-muted-foreground" />
      </PageHeader>
      <IntakeSubmitForm formId={found.form.id} fields={found.form.fields} />
    </Page>
  );
}
