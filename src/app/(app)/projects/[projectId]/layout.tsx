import { accentOf } from "@/modules/work/enums";
import { findProject } from "@/modules/work/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every plan page of a project wears its colour (or its team's) as the accent. Only the colour is
// read here; each page still decides whether the viewer may open the project at all.
export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const found = UUID.test(projectId) ? await findProject(projectId) : undefined;
  return <div data-accent={found ? accentOf(found.project.color, found.team.color) : undefined}>{children}</div>;
}
