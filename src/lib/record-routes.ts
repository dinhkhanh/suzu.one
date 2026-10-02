// Where each kind of record is opened. One table, so a name shown anywhere in the app links to the
// same page (`RecordLink` in components/ui/record-link.tsx), and a moved route is changed once.
// No I/O and no "server-only": notifications, exports and client components all read it.

const ROUTES = {
  person: (id) => `/people/${id}`,
  /** A department, a team or any other org unit: the directory, filtered to it. */
  unit: (id) => `/people?departmentId=${id}`,
  entity: (id) => `/admin/entities/${id}`,
  project: (id) => `/projects/${id}`,
  task: (id) => `/work/tasks/${id}`,
  team: (id) => `/work/teams/${id}`,
  account: (id) => `/crm/accounts/${id}`,
  deal: (id) => `/crm/deals/${id}`,
  lead: (id) => `/crm/leads/${id}`,
  contract: (id) => `/crm/contracts/${id}`,
  invoice: (id) => `/crm/invoices/${id}`,
  asset: (id) => `/assets/${id}`,
  digitalAsset: (id) => `/assets/digital/${id}`,
  licence: (id) => `/assets/licences/${id}`,
  booking: (id) => `/assets/bookings/${id}`,
  kbPage: (id) => `/kb/pages/${id}`,
  /** By the space's key, not its id. */
  kbSpace: (key) => `/kb/spaces/${key}`,
  announcement: (id) => `/announcements/${id}`,
  opening: (id) => `/recruit/${id}`,
  candidate: (id) => `/recruit/candidates/${id}`,
  application: (id) => `/recruit/applications/${id}`,
  interview: (id) => `/recruit/interviews/${id}`,
  offer: (id) => `/recruit/offers/${id}`,
  hiringRequest: (id) => `/recruit/hiring/${id}`,
  goal: (id) => `/performance/goals/${id}`,
  payrollRun: (id) => `/payroll/runs/${id}`,
  payslip: (id) => `/payslips/${id}`,
  obligation: (id) => `/ops/obligations/${id}`,
  device: (id) => `/attendance/devices/${id}`,
  dailyReport: (id) => `/daily/reports/${id}`,
  feedback: (id) => `/feedback/${id}`,
} as const satisfies Record<string, (id: string) => string>;

export type RecordKind = keyof typeof ROUTES;

export const RECORD_KINDS = Object.keys(ROUTES) as RecordKind[];

/** The page a record is opened on. */
export function recordHref(kind: RecordKind, id: string): string {
  return ROUTES[kind](id);
}
