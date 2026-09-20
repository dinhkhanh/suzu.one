import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listFileNames } from "@/modules/platform/files/service";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { decideRequestAction, refileRequestAction } from "@/modules/requests/actions";
import { getGenericRequest } from "@/modules/requests/service";
import { Answers } from "@/modules/requests/ui/answers";
import { RequestForm } from "@/modules/requests/ui/request-form";

export const metadata: Metadata = { title: "Request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request of one of the builder's types: what was asked, who answered, and the decision form
// for whoever's turn it is. Every access rule is the approval engine's own.
export default async function GenericRequestPage(props: PageProps<"/approvals/request/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getGenericRequest({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const t = await getTranslations("requests");
  const locale = await getLocale();
  const { request, type, submission } = view;
  const returned = view.isRequester && request.status === "returned";
  const fileIds = submission.attachmentFileIds ?? [];
  const [fileNames, people, entities] = await Promise.all([
    fileIds.length ? listFileNames(fileIds) : Promise.resolve(new Map<string, string>()),
    returned && type.form.fields.some((field) => field.type === "person") ? listPersonNames() : Promise.resolve([]),
    returned && type.form.fields.some((field) => field.type === "entity") ? listEntities() : Promise.resolve([]),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link href="/approvals" className="text-sm text-muted-foreground hover:underline">
          ← {t("backToApprovals")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{locale === "en" ? type.nameEn : type.nameVi}</h1>
          <RequestStatusBadge status={request.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.isRequester ? view.requesterName : <Link href={`/people/${request.requesterPersonId}`} className="hover:underline">{view.requesterName}</Link>}
        </p>
      </header>

      <Answers form={type.form} values={submission.values} requestId={request.id} fileNames={fileNames} />

      {view.canDecide ? <DecisionForm requestId={request.id} action={decideRequestAction} /> : null}
      {returned ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("view.correctAndResend")}</h2>
          <RequestForm
            form={type.form}
            submit={refileRequestAction}
            extra={{ requestId: request.id }}
            initialValues={submission.values as Record<string, never>}
            people={people}
            entities={entities.map((entity) => ({ id: entity.id, name: entity.shortName }))}
            submitLabel={t("view.resend")}
          />
        </section>
      ) : null}
      {view.isRequester && (request.status === "pending" || request.status === "returned") ? <WithdrawForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestHistory view={view} />
    </div>
  );
}
