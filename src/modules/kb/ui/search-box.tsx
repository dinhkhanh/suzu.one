import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A plain GET form: search works without JavaScript and the result page can be linked to. */
export async function KbSearchBox({ query = "", spaceId, compact = false }: { query?: string; spaceId?: string | null; compact?: boolean }) {
  const t = await getTranslations("kb");
  return (
    <form action="/kb/search" method="get" role="search" className="flex items-center gap-2">
      <Input type="search" name="q" defaultValue={query} maxLength={200} placeholder={t("search.placeholder")} aria-label={t("search.title")} className={compact ? "h-8" : "max-w-md"} />
      {spaceId ? <input type="hidden" name="space" value={spaceId} /> : null}
      {compact ? null : (
        <Button type="submit" variant="outline">
          {t("search.submit")}
        </Button>
      )}
    </form>
  );
}
