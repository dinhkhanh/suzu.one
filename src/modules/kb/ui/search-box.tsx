import { SearchIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "cn";

/** A plain GET form: search works without JavaScript and the result page can be linked to. */
export async function KbSearchBox({ query = "", spaceId, compact = false, className }: { query?: string; spaceId?: string | null; compact?: boolean; className?: string }) {
  const t = await getTranslations("kb");
  return (
    <form action="/kb/search" method="get" role="search" className={cn("flex w-full items-center gap-2", compact ? "max-w-none" : "max-w-xl", className)}>
      <InputGroup className={compact ? "h-9 md:h-8" : undefined}>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput type="search" name="q" defaultValue={query} maxLength={200} placeholder={t("search.placeholder")} aria-label={t("search.title")} />
      </InputGroup>
      {spaceId ? <input type="hidden" name="space" value={spaceId} /> : null}
      {compact ? null : (
        <Button type="submit" variant="outline">
          {t("search.submit")}
        </Button>
      )}
    </form>
  );
}
