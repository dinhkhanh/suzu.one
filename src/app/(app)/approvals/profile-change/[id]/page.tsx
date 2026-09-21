import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decideProfileChangeAction } from "@/modules/core-hr/change-request-actions";
import { getProfileChange } from "@/modules/core-hr/change-requests";
import { getPersonView } from "@/modules/core-hr/service";
import { ChangeRequestForm, ChangeRequestReveal } from "@/modules/core-hr/ui/change-request-forms";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Change request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProfileChangePage(props: PageProps<"/approvals/profile-change/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getProfileChange({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const t = await getTranslations("changeRequests");
  const { request, payload } = view;
  const personal = Object.entries(payload.personal);
  const value = (field: string, raw: string | null) => (raw === null ? "—" : field === "maritalStatus" ? t(`maritalStatus.${raw}` as "maritalStatus.single") : raw);
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");
  // A returned request is corrected starting from what was proposed, not from scratch.
  const profile = view.isRequester && request.status === "returned" ? (await getPersonView(user.principal, user.person.id))?.personal?.profile : null;
  const proposed = Object.fromEntries(personal.map(([field, change]) => [field, change.to]));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{t("detail.title")}</h1>
          <RequestStatusBadge status={request.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.isRequester ? view.requesterName : <Link href={`/people/${request.requesterPersonId}`} className="hover:underline">{view.requesterName}</Link>}
        </p>
      </header>

      {personal.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("detail.personal")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.field")}</TableHead>
                <TableHead>{t("detail.from")}</TableHead>
                <TableHead>{t("detail.to")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personal.map(([field, change]) => (
                <TableRow key={field}>
                  <TableCell>{t(`fields.${field}` as "fields.phone")}</TableCell>
                  <TableCell className="text-muted-foreground">{value(field, change.from)}</TableCell>
                  <TableCell>{value(field, change.to)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {payload.restricted.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("detail.restricted")}</h2>
          <ChangeRequestReveal requestId={request.id} fields={payload.restricted} canReveal={view.canReveal} />
          {view.canDecide ? (
            <p className="text-xs text-muted-foreground">
              {t("detail.currentValues")}{" "}
              <Link href={`/people/${request.requesterPersonId}`} className="underline">
                {view.requesterName}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {view.canDecide ? (
        <DecisionForm requestId={request.id} action={decideProfileChangeAction}>
          {payload.restricted.includes("bankAccount") ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="verifiedSecondChannel" className="mt-0.5" />
              <span>{t("detail.verify")}</span>
            </label>
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
      <RequestHistory view={view} />
    </div>
  );
}
