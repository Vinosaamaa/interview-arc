import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function ResourcesPage() { redirect("/?view=learn&learn=library"); }
