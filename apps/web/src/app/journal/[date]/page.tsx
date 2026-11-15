import { redirect } from "next/navigation";

export default async function JournalDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect("/journal");
  const incoming = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "focusDate") continue;
    if (typeof value === "string" && value) query.set(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  query.set("focusDate", date);
  redirect(`/journal?${query.toString()}`);
}
