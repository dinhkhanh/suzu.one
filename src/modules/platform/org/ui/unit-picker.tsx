"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import type { UnitOption } from "./org-forms";

// The phone's stand-in for the tree pane: one Select over the whole tree, each name indented by
// its depth, that opens the chosen unit's page.
export function UnitPicker({ units, value }: { units: UnitOption[]; value: string }) {
  const t = useTranslations("org");
  const router = useRouter();
  return (
    <Select aria-label={t("pickUnit")} value={value} onChange={(event) => router.push(`/admin/org?unit=${event.target.value}`)}>
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {`${"— ".repeat(unit.depth)}${unit.name}`}
        </option>
      ))}
    </Select>
  );
}
