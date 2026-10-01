"use client";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import type { KpiUnit, MetricType } from "../enums";

type Props = Omit<ComponentProps<"input">, "type" | "inputMode" | "value" | "defaultValue" | "onChange"> & { unit: MetricType | KpiUnit; defaultValue?: string };

/**
 * A goal's or a KPI's figure, in its own unit: an amount of money is grouped as it is typed, a count
 * or a percentage is typed as it reads ("12,5"). `parseMetricValue` reads either.
 */
export function MetricValueInput({ unit, maxLength, ...props }: Props) {
  return unit === "currency" ? <MoneyInput {...props} allowNegative /> : <Input {...props} inputMode="decimal" maxLength={maxLength} />;
}
