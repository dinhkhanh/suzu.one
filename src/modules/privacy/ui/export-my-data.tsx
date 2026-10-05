"use client";
// "Export my data" (NFR-PRV-03): one key, one JSON file. The file carries the person's pay, so a
// stale session is sent to prove who it is first and comes back here.
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportMyDataAction } from "../actions";

export function ExportMyDataButton() {
  const t = useTranslations("privacy.mine");
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<"step_up" | "failed" | null>(null);
  const download = () =>
    start(async () => {
      const result = await exportMyDataAction({});
      if (!result.ok) return setProblem(result.error === "failed" && result.message === "step_up_required" ? "step_up" : "failed");
      setProblem(null);
      const url = URL.createObjectURL(new Blob([result.data.json], { type: "application/json;charset=utf-8" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: result.data.fileName });
      link.click();
      URL.revokeObjectURL(url);
    });
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="outline" disabled={pending} onClick={download}>
          <DownloadIcon aria-hidden />
          {pending ? t("exporting") : t("export")}
        </Button>
      </div>
      {problem === "step_up" ? (
        <p role="alert" className="text-sm">
          {t("stepUp")}{" "}
          <Link href="/step-up?next=%2Fme%23privacy" className="font-medium text-link">
            {t("stepUpLink")}
          </Link>
        </p>
      ) : null}
      {problem === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("exportFailed")}
        </p>
      ) : null}
    </div>
  );
}
