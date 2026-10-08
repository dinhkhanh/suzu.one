import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { getPersonTarget } from "@/modules/core-hr/service";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listFileNames } from "@/modules/platform/files/service";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { todayInVietnam } from "@/lib/dates";
import { decideRequestAction, refileRequestAction } from "@/modules/requests/actions";
import { EXPENSE_CLAIM_CODE, getExpenseClaim } from "@/modules/requests/expense";
import { refileExpenseClaimAction } from "@/modules/requests/expense-actions";
import { payoutOf } from "@/modules/requests/payments";
import { getGenericRequest, getRequestFamily } from "@/modules/requests/service";
import { Answers } from "@/modules/requests/ui/answers";
import { FollowUps, ParentRequest } from "@/modules/requests/ui/follow-ups";
import { ClaimLines } from "@/modules/requests/ui/claim-lines";
import { ExpenseClaimForm } from "@/modules/requests/ui/expense-claim-form";
import { RequestForm } from "@/modules/requests/ui/request-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("request");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request of one of the builder's types: what was asked, who answered, and the decision form
// for whoever's turn it is. Every access rule is the approval engine's own.
export default async function GenericRequestPage(props: PageProps<"/approvals/request/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getGenericRequest({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();
  // An expense claim is the one type that carries more than its answers; the same view, read again
  // with its lines. The access rule is the engine's either way.
  const claim = view.submission.typeCode === EXPENSE_CLAIM_CODE ? await getExpenseClaim({ personId: user.person.id, principal: user.principal }, id) : null;

  const t = await getTranslations("requests");
  const locale = await getLocale();
  const { request, type, submission } = view;
  const returned = view.isRequester && request.status === "returned";
  const fileIds = submission.attachmentFileIds ?? [];
  const [family, fileNames, people, entities, payout, format] = await Promise.all([
    // FR-REQ-05: what it was filed under and what was filed under it. The requester's entity only
    // decides which follow-up types they may file themselves.
    (view.isRequester && view.type.followUps.length > 0 ? getPersonTarget(user.person.id) : Promise.resolve(null)).then((target) => getRequestFamily(view, { entityId: target?.entityId ?? null })),
    fileIds.length ? listFileNames(fileIds) : Promise.resolve(new Map<string, string>()),
    type.form.fields.some((field) => field.type === "person") ? listPersonNames() : Promise.resolve([]),
    type.form.fields.some((field) => field.type === "entity") ? listEntities() : Promise.resolve([]),
    // REQ-01: where an approved payment, purchase or advance stands with finance.
    type.payout !== "none" && request.status === "approved" ? payoutOf(request.id) : Promise.resolve(null),
    getFormatter(),
  ]);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const recordNames = new Map<string, string>([...people.map((person) => [person.id, person.fullName] as const), ...entities.map((entity) => [entity.id, entity.shortName] as const)]);
  const typeName = locale === "en" ? type.nameEn : type.nameVi;

  return (
    // A claim carries a table of lines, which wants the room; everything else reads best narrow.
    <Page width={claim ? "default" : "narrow"}>
      <RequestHeader
        title={request.summary || typeName}
        kind={typeName}
        status={request.status}
        requestId={request.id}
        who={
          <RecordLink kind="person" id={request.requesterPersonId}>
            {view.requesterName}
          </RecordLink>
        }
        actions={
          <Link href="/approvals" className="text-sm text-link hover:underline">
            ← {t("backToApprovals")}
          </Link>
        }
      />

      {family.parent ? <ParentRequest parent={family.parent} /> : null}

      <Section title={t("view.details")}>
        <Answers form={type.form} values={submission.values} requestId={request.id} fileNames={fileNames} recordNames={recordNames} />
      </Section>
      {payout ? (
        <Alert variant={payout.paidOn ? "success" : "info"}>
          {payout.paidOn
            ? payout.settlement.toPay < 0
              ? t("view.payoutCollected", { amount: money(-payout.settlement.toPay), date: day(payout.paidOn), reference: payout.paidReference ?? "" })
              : t("view.payoutPaid", { amount: money(payout.settlement.toPay), date: day(payout.paidOn), reference: payout.paidReference ?? "" })
            : payout.blocked
              ? t("view.payoutWaitingAdvance")
              : t("view.payoutWaiting", { amount: money(payout.settlement.toPay) })}
          {payout.settlement.nettedAdvance ? ` ${t("view.payoutNetted", { advance: money(payout.settlement.nettedAdvance) })}` : null}
        </Alert>
      ) : null}
      {submission.documentId ? (
        // REQ-02: the letter an approved confirmation-letter request made. The PDF route decides who may open it.
        <Alert variant="success">
          {view.isRequester ? (
            // The person's own issued papers are listed on /me, and open there.
            <>
              {t("view.letterCollect")}{" "}
              <Link href="/me#documents" className="text-link hover:underline">
                {t("view.letterMine")}
              </Link>
            </>
          ) : (
            <>
              {t("view.letter")}{" "}
              <a href={`/documents/${submission.documentId}/pdf`} className="text-link hover:underline">
                {t("view.letterOpen")}
              </a>
            </>
          )}
        </Alert>
      ) : null}
      {claim ? <ClaimLines lines={claim.lines} total={claim.total} byCategory={claim.byCategory} payment={claim.payment} requestId={request.id} fileNames={fileNames} /> : null}

      <FollowUps family={family} requestId={request.id} />

      <ApprovalChain view={view} />

      {view.canDecide ? <DecisionForm requestId={request.id} action={decideRequestAction} /> : null}
      {returned ? (
        <Section title={t("view.correctAndResend")}>
          {claim ? (
            <ExpenseClaimForm
              form={type.form}
              today={todayInVietnam()}
              submit={refileExpenseClaimAction}
              extra={{ requestId: request.id }}
              initialValues={submission.values as Record<string, never>}
              initialLines={claim.lines.map((line) => ({ lineDate: line.lineDate, category: line.category, description: line.description, amount: line.amount, receiptFileId: line.receiptFileId, projectTag: line.projectTag }))}
              submitLabel={t("view.resend")}
            />
          ) : (
            <RequestForm
              form={type.form}
              submit={refileRequestAction}
              extra={{ requestId: request.id }}
              initialValues={submission.values as Record<string, never>}
              people={people}
              entities={entities.map((entity) => ({ id: entity.id, name: entity.shortName }))}
              submitLabel={t("view.resend")}
            />
          )}
        </Section>
      ) : null}
      {view.isRequester && (request.status === "pending" || request.status === "returned") ? <WithdrawForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
