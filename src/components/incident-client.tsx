"use client";

import { useCommandState, type CommandPayload } from "@/components/use-command-state";
import { WarRoom } from "@/components/war-room";

export function IncidentClient({
  id,
  initial,
}: {
  id: string;
  initial: CommandPayload;
}) {
  const { payload, error } = useCommandState(initial);
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="kicker">{error}</p>
      </div>
    );
  }
  const data = payload ?? initial;
  const incident = data.state.incidents.find((i) => i.id === id);
  if (!incident) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="kicker">{id} is not in the active set.</p>
      </div>
    );
  }
  return <WarRoom state={data.state} incident={incident} rec={data.recs[id] ?? null} />;
}
