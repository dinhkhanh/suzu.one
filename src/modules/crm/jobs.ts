// The CRM's scheduled work. Each job is safe to run twice: every reminder records that it was sent,
// every renewal is held to one by a unique index, and the lifecycle pass moves nothing already moved.
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { refreshLifecycles } from "./accounts";
import { sendFollowUpReminders } from "./activities";
import { applyLeaveCover } from "./cover";
import { openRenewals } from "./contracts";
import { sendStaleReminders } from "./deals";
import { sendReceivableReminders } from "./invoices";
import { reconcileQuotes } from "./quotes";
import { postConfirmedCommissions } from "./commission";

/**
 * At midnight: each account's lifecycle as its facts now suggest (FR-CRM-01), sent quotes past their
 * validity expired, and quotes whose approval the inbox withdrew or returned back in draft.
 */
export const crmNightlyJob: JobDefinition = {
  name: "crm-nightly",
  // Confirmed commission statements still waiting for an open payroll run go into one (FR-CRM-45).
  run: async ({ today }) => ({ ...(await refreshLifecycles(today)), ...(await reconcileQuotes(today)), commission: await postConfirmedCommissions(null) }),
};

/**
 * In the morning, before the digest: leave cover of follow-ups (FR-CRM-41), follow-ups due today (FR-CRM-06), renewals opening
 * (FR-CRM-26), overdue invoices (FR-CRM-32) and deals gone quiet (FR-CRM-13).
 */
export const crmMorningJob: JobDefinition = {
  name: "crm-reminders",
  // Leave cover first (FR-CRM-41): a follow-up covered this morning reminds its cover, not the absent owner.
  run: async ({ today }) => ({ ...(await applyLeaveCover(today)), ...(await sendFollowUpReminders(today)), ...(await openRenewals(today)), ...(await sendReceivableReminders(today)), ...(await sendStaleReminders(today)) }),
};
