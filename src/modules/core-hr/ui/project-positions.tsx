import { getTranslations } from "next-intl/server";
import { RecordLink } from "@/components/ui/record-link";
import { Fact } from "./fact-sheet";

// The automatic half of a person's position ("chức vụ"): the posts they hold in running projects,
// one to a line — the post, then the project it is held in. Nothing is typed here: the row appears
// when a project names the person its lead or account manager, and goes when the project closes
// or the post passes on. The page hands over only the projects its viewer may open. Server component.
export async function ProjectPositions({ appointments }: { appointments: readonly { projectId: string; projectName: string; role: "lead" | "account_manager" }[] }) {
  if (appointments.length === 0) return null;
  const t = await getTranslations("people");
  return (
    <Fact label={t("fields.projectPositions")}>
      <ul className="flex flex-col gap-1">
        {appointments.map((appointment) => (
          <li key={`${appointment.projectId}:${appointment.role}`}>
            <span className="text-muted-foreground">{t(`projectPosition.${appointment.role}`)} · </span>
            <RecordLink kind="project" id={appointment.projectId}>
              {appointment.projectName}
            </RecordLink>
          </li>
        ))}
      </ul>
    </Fact>
  );
}
