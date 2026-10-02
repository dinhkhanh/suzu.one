import { redirect } from "next/navigation";

// My work moved under the Today page's tabs (FR-WRK-06); old links and bookmarks land on the same view.
export default async function MyWorkPage({ searchParams }: PageProps<"/tasks">) {
  const { view } = await searchParams;
  redirect(typeof view === "string" && view !== "all" ? `/today?view=${encodeURIComponent(view)}` : "/today");
}
