import { redirect } from "next/navigation";

// The onboarding and offboarding templates moved to /checklists, beside the checklist library.
export default function ChecklistsMoved() {
  redirect("/checklists");
}
