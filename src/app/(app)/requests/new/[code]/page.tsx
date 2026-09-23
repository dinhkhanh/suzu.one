import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonTarget } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { todayInVietnam } from "@/lib/dates";
import { fileRequestAction } from "@/modules/requests/actions";
import { EXPENSE_CLAIM_CODE } from "@/modules/requests/expense";
import { fileExpenseClaimAction } from "@/modules/requests/expense-actions";
import { findRequestTypeByCode } from "@/modules/requests/service";
import { ExpenseClaimForm } from "@/modules/requests/ui/expense-claim-form";
import { RequestForm } from "@/modules/requests/ui/request-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newRequest");

// The form the administrator designed, filled in by whoever needs the thing.
export default async function FileRequestPage(props: PageProps<"/requests/new/[code]">) {
  const user = await requireUser();
  const { code } = await props.params;
  const [type, target, t, locale] = await Promise.all([findRequestTypeByCode(code), getPersonTarget(user.person.id), getTranslations("requests"), getLocale()]);
  if (!type || !type.active) notFound();
  if (type.entityId && type.entityId !== target?.entityId) notFound();

  const needsPeople = type.form.fields.some((field) => field.type === "person");
  const needsEntities = type.form.fields.some((field) => field.type === "entity");
  const [people, entities] = await Promise.all([needsPeople ? listPersonNames() : Promise.resolve([]), needsEntities ? listEntities() : Promise.resolve([])]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href="/requests/new" className="text-sm text-muted-foreground hover:underline">
          ← {t("new")}
        </Link>
        <h1>{locale === "en" ? type.nameEn : type.nameVi}</h1>
        <p className="text-sm text-muted-foreground">{(locale === "en" ? type.descriptionEn : type.descriptionVi) ?? ""}</p>
      </header>
      {type.code === EXPENSE_CLAIM_CODE ? (
        <ExpenseClaimForm form={type.form} today={todayInVietnam()} submit={fileExpenseClaimAction} extra={{}} submitLabel={t("form.submit")} />
      ) : (
        <RequestForm
          form={type.form}
          submit={fileRequestAction}
          extra={{ code: type.code }}
          people={people}
          entities={entities.map((entity) => ({ id: entity.id, name: entity.shortName }))}
          submitLabel={t("form.submit")}
        />
      )}
    </div>
  );
}
