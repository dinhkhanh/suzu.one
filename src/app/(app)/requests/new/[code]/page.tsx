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
import { findRequestTypeByCode, followUpContext } from "@/modules/requests/service";
import { FollowUpGateNote } from "@/modules/requests/ui/follow-ups";
import { ExpenseClaimForm } from "@/modules/requests/ui/expense-claim-form";
import { RequestForm } from "@/modules/requests/ui/request-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The form the administrator designed, filled in by whoever needs the thing. With `?parent=<id>`
// it is a follow-up (FR-REQ-05) — an advance under its business trip — and starts from the answers
// the two forms share.
export default async function FileRequestPage(props: PageProps<"/requests/new/[code]">) {
  const user = await requireUser();
  const [{ code }, { parent: parentParam }] = await Promise.all([props.params, props.searchParams]);
  const parentRequestId = typeof parentParam === "string" && UUID.test(parentParam) ? parentParam : null;
  const [type, target, t, locale] = await Promise.all([findRequestTypeByCode(code), getPersonTarget(user.person.id), getTranslations("requests"), getLocale()]);
  if (!type || !type.active) notFound();
  if (type.entityId && type.entityId !== target?.entityId) notFound();
  // The same rule the action applies again when the form is sent.
  const followUp = parentRequestId ? await followUpContext({ personId: user.person.id, principal: user.principal, entityId: target?.entityId ?? null }, parentRequestId, type) : null;
  if (parentRequestId && !followUp) notFound();
  if (!type.standalone && !followUp) notFound();
  const parentName = followUp ? (locale === "en" ? followUp.parent.type.nameEn : followUp.parent.type.nameVi) : null;

  const needsPeople = type.form.fields.some((field) => field.type === "person");
  const needsEntities = type.form.fields.some((field) => field.type === "entity");
  const [people, entities] = await Promise.all([needsPeople ? listPersonNames() : Promise.resolve([]), needsEntities ? listEntities() : Promise.resolve([])]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        {followUp ? (
          <Link href={`/approvals/request/${followUp.parent.request.id}`} className="text-sm text-link hover:underline">
            ← {parentName}
          </Link>
        ) : (
          <Link href="/requests/new" className="text-sm text-link hover:underline">
            ← {t("new")}
          </Link>
        )}
        <h1>{locale === "en" ? type.nameEn : type.nameVi}</h1>
        <p className="text-sm text-muted-foreground">{(locale === "en" ? type.descriptionEn : type.descriptionVi) ?? ""}</p>
      </header>
      {followUp ? (
        <div className="flex flex-col gap-1 rounded-xl border bg-muted/40 p-3 text-sm">
          <span className="text-xs text-muted-foreground">{t("followUps.filedUnder")}</span>
          <Link href={`/approvals/request/${followUp.parent.request.id}`} className="font-medium hover:underline">
            {parentName} · {followUp.parent.request.summary}
          </Link>
          {Object.keys(followUp.values).length > 0 ? <span className="text-xs text-muted-foreground">{t("followUps.carriedOver", { name: parentName ?? "" })}</span> : null}
        </div>
      ) : null}
      {followUp && !followUp.gate.open ? (
        <FollowUpGateNote gate={followUp.gate} />
      ) : type.code === EXPENSE_CLAIM_CODE ? (
        <ExpenseClaimForm
          form={type.form}
          today={todayInVietnam()}
          submit={fileExpenseClaimAction}
          extra={{ parentRequestId: parentRequestId ?? "" }}
          initialValues={followUp?.values}
          submitLabel={t("form.submit")}
        />
      ) : (
        <RequestForm
          form={type.form}
          submit={fileRequestAction}
          extra={{ code: type.code, parentRequestId: parentRequestId ?? "" }}
          initialValues={followUp?.values}
          people={people}
          entities={entities.map((entity) => ({ id: entity.id, name: entity.shortName }))}
          submitLabel={t("form.submit")}
        />
      )}
    </div>
  );
}
