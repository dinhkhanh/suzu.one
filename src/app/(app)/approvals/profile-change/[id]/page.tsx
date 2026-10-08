import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Page, Section } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { decideProfileChangeAction } from "@/modules/core-hr/change-request-actions";
import { getProfileChange } from "@/modules/core-hr/change-requests";
import { getPersonView } from "@/modules/core-hr/service";
import { ChangeRequestForm, ChangeRequestReveal } from "@/modules/core-hr/ui/change-request-forms";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("changeRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProfileChangePage(props: PageProps<"/approvals/profile-change/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getProfileChange({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tApprovals] = await Promise.all([getTranslations("changeRequests"), getTranslations("approvals")]);
  const { request, payload } = view;
  const personal = Object.entries(payload.personal);
  const value = (field: string, raw: string | null) => (raw === null ? "—" : field === "maritalStatus" ? t(`maritalStatus.${raw}` as "maritalStatus.single") : raw);
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");
  // A returned request is corrected starting from what was proposed, not from scratch.
  const profile = view.isRequester && request.status === "returned" ? (await getPersonView(user.principal, user.person.id))?.personal?.profile : null;
  const proposed = Object.fromEntries(personal.map(([field, change]) => [field, change.to]));

  return (
    <Page width="narrow">
      <RequestHeader
        title={t("detail.title")}
        kind={tApprovals("types.profile_change")}
        status={request.status}
        requestId={request.id}
        who={
          <RecordLink kind="person" id={request.requesterPersonId}>
            {view.requesterName}
          </RecordLink>
        }
      />

      {personal.length > 0 ? (
        <Section title={t("detail.personal")}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("detail.field")}</TableHead>
                <TableHead kind="text">{t("detail.from")}</TableHead>
                <TableHead kind="text">{t("detail.to")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personal.map(([field, change]) => (
                <TableRow key={field}>
                  <TableCell className="text-muted-foreground">{t(`fields.${field}` as "fields.phone")}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground line-through decoration-border">{value(field, change.from)}</TableCell>
                  <TableCell className="whitespace-normal font-medium">{value(field, change.to)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {payload.restricted.length > 0 ? (
        <Section title={t("detail.restricted")}>
          <ChangeRequestReveal requestId={request.id} fields={payload.restricted} canReveal={view.canReveal} />
          {view.canDecide ? (
            <p className="text-xs text-muted-foreground">
              {t("detail.currentValues")}{" "}
              <RecordLink kind="person" id={request.requesterPersonId} className="text-link">
                {view.requesterName}
              </RecordLink>
            </p>
          ) : null}
        </Section>
      ) : null}

      <ApprovalChain view={view} />

      {view.canDecide ? (
        <DecisionForm requestId={request.id} action={decideProfileChangeAction}>
          {payload.restricted.includes("bankAccount") ? (
            <Label className="items-start gap-2 text-sm font-normal leading-snug">
              <Checkbox name="verifiedSecondChannel" className="mt-0.5" />
              <span>{t("detail.verify")}</span>
            </Label>
          ) : null}
        </DecisionForm>
      ) : null}

      {profile !== null && view.isRequester && request.status === "returned" ? (
        <ChangeRequestForm
          requestId={request.id}
          current={{
            phone: profile?.phone ?? null,
            personalEmail: profile?.personalEmail ?? null,
            permanentAddress: profile?.permanentAddress ?? null,
            currentAddress: profile?.currentAddress ?? null,
            maritalStatus: profile?.maritalStatus ?? null,
            ...proposed,
          }}
        />
      ) : null}
      {canWithdraw ? <WithdrawForm requestId={request.id} /> : null}

      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
