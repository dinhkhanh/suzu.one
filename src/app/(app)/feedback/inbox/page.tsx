import { getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackCategory, type FeedbackStatus } from "@/modules/feedback/enums";
import { canOpenFeedbackInbox, feedbackReach } from "@/modules/feedback/policy";
import { countFeedbackByStatus, FEEDBACK_PAGE_SIZE, type FeedbackFilters, listFeedbackAreas, listFeedbackInbox } from "@/modules/feedback/service";
import { FeedbackList } from "@/modules/feedback/ui/feedback-list";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("feedbackInbox");

const STATUS_TABS = ["open", ...FEEDBACK_STATUSES, "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default async function FeedbackInboxPage(props: PageProps<"/feedback/inbox">) {
  const user = await requireUser();
  if (!canOpenFeedbackInbox(user.principal)) notFound();
  const reach = feedbackReach(user.principal);

  const query = await props.searchParams;
  const one = (key: string) => (typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined);
  const tab: StatusTab = (STATUS_TABS as readonly string[]).includes(one("status") ?? "") ? (one("status") as StatusTab) : "open";
  const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(one("category") ?? "") ? (one("category") as FeedbackCategory) : undefined;
  const area = /^[a-z][a-z0-9-]{0,39}$/.test(one("area") ?? "") ? one("area") : undefined;
  const blocking = one("blocking") === "1";
  const page = Number.parseInt(one("page") ?? "1", 10) || 1;
  const filters: FeedbackFilters = { status: tab === "all" ? undefined : (tab as FeedbackStatus | "open"), category, area, blocking, page };

  const [t, { rows, total }, counts, areas] = await Promise.all([getTranslations("feedback"), listFeedbackInbox(reach, filters), countFeedbackByStatus(reach, { category, area, blocking }), listFeedbackAreas(reach)]);
  const tabCount: Record<StatusTab, number> = { ...counts, open: counts.new + counts.in_progress, all: counts.new + counts.in_progress + counts.resolved + counts.declined };
  const href = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ status: tab, category, area, blocking: blocking ? "1" : undefined, ...over }).filter((entry): entry is [string, string] => !!entry[1]));
    return `/feedback/inbox?${params.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1>{t("inbox.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("inbox.help")}</p>
        </div>
        <Link href="/feedback" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("inbox.mine")}
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["new", "in_progress", "resolved"] as const).map((status) => (
          <div key={status} className="rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">{t(`statuses.${status}`)}</p>
            <p className="text-2xl font-semibold tabular-nums">{counts[status]}</p>
          </div>
        ))}
        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("inbox.blockingOpen")}</p>
          <p className={cn("text-2xl font-semibold tabular-nums", counts.blockingOpen > 0 && "text-destructive")}>{counts.blockingOpen}</p>
        </div>
      </div>

      <nav aria-label={t("inbox.statusFilter")} className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((value) => (
          <Link key={value} href={href({ status: value, page: undefined })} aria-current={value === tab ? "page" : undefined} className={buttonVariants({ variant: value === tab ? "secondary" : "ghost", size: "sm" })}>
            {value === "open" || value === "all" ? t(`inbox.tabs.${value}`) : t(`statuses.${value}`)}
            <span className="text-xs text-muted-foreground tabular-nums">{tabCount[value]}</span>
          </Link>
        ))}
      </nav>

      <Form action="/feedback/inbox" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={tab} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("inbox.category")}</span>
          <Select name="category" defaultValue={category ?? ""} className="w-44">
            <option value="">{t("inbox.any")}</option>
            {FEEDBACK_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`categories.${value}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("inbox.area")}</span>
          <Select name="area" defaultValue={area ?? ""} className="w-44">
            <option value="">{t("inbox.any")}</option>
            {areas.map((row) => (
              <option key={row.area} value={row.area}>
                /{row.area} ({row.count})
              </option>
            ))}
          </Select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="blocking" value="1" defaultChecked={blocking} className="size-4" />
          {t("inbox.onlyBlocking")}
        </label>
        <Button type="submit" variant="outline">
          {t("inbox.apply")}
        </Button>
      </Form>

      <FeedbackList items={rows} showPerson empty={t("inbox.empty")} />

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("inbox.pageOf", { page, pages, total })}</span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={href({ page: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("inbox.previous")}
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={href({ page: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("inbox.next")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
