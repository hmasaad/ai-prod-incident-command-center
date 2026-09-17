import { IncidentClient } from "@/components/incident-client";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentClient id={id} initial={getStore().payload()} />;
}
