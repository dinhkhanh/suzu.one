import { redirect } from "next/navigation";

export default function LeaveAdminIndex() {
  redirect("/leave/admin/balances");
}
