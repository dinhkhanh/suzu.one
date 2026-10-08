import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { decideAttendanceRuleAction } from "@/modules/attendance/device-actions";
import { getAttendanceRuleChange } from "@/modules/attendance/rule-changes";
import { decideLeaveRuleAction } from "@/modules/leave/actions";
import { getLeaveRuleChange } from "@/modules/leave/rule-changes";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("ruleChange");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A proposed leave or attendance rule (FR-PLT-39): what HR asked to change, field by field against
// the rule as it stands, and the owner's decision. Nothing on this page has taken effect until the
// request reads "approved".
export default async function RuleChangePage(props: PageProps<"/approvals/rule/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const viewer = { personId: user.person.id, principal: user.principal };
  const leave = UUID.test(id) ? await getLeaveRuleChange(viewer, id) : null;
  const attendance = !leave && UUID.test(id) ? await getAttendanceRuleChange(viewer, id) : null;
  const view = leave ?? attendance;
  if (!view) notFound();

  const [t, tApprovals, format] = await Promise.all([getTranslations("approvals.rule"), getTranslations("approvals"), getFormatter()]);
  const { request } = view;
  const change = view.change;
  const input = change.input as Record<string, unknown>;
  const before = change.before as Record<string, unknown> | null;
  const show = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    // Amounts of leave are hundredths of a day.
    if (typeof value === "number") return key.endsWith("Centi") ? t("days", { days: format.number(value / 100, { maximumFractionDigits: 2 }) }) : format.number(value);
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  };
  const keys = Object.keys(input).filter((key) => key !== "id" && key !== "leaveTypeId" && key !== "entityId");
  const decidesRules = can(user.principal, "payroll:rules", {});
  const open = request.status === "pending" || request.status === "returned";

  return (
    <Page width="narrow">
      <RequestHeader
        title={request.summary}
        kind={tApprovals(`types.${request.type}` as "types.leave_rule")}
        status={request.status}
        requestId={request.id}
        who={
          <RecordLink kind="person" id={request.requesterPersonId}>
            {view.requesterName}
          </RecordLink>
        }
      />
      <Alert variant={request.status === "approved" ? "success" : "info"}>{request.status === "approved" ? t("inForce") : t("notYet")}</Alert>
      <Section title={t("changes")} description={before ? t("againstCurrent") : t("newRule")}>
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("field")}</TableHead>
              {before ? <TableHead kind="text">{t("current")}</TableHead> : null}
              <TableHead kind="text">{t("proposed")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => {
              const changed = !before || show(key, before[key]) !== show(key, input[key]);
              return (
                <TableRow key={key} className={cn(!changed && "text-muted-foreground")}>
                  <TableCell kind="id">{key}</TableCell>
                  {before ? <TableCell className="whitespace-normal">{show(key, before[key])}</TableCell> : null}
                  <TableCell className={cn("whitespace-normal", changed && "font-medium")}>{show(key, input[key])}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>
      <ApprovalChain view={view} />
      {view.canDecide && decidesRules ? <DecisionForm requestId={request.id} action={leave ? decideLeaveRuleAction : decideAttendanceRuleAction} allowReturn={false} /> : null}
      {view.canDecide && !decidesRules ? <Alert variant="warning">{t("ownerOnly")}</Alert> : null}
      {view.isRequester && open ? <WithdrawForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
