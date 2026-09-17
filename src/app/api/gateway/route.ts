import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import type { ActionType } from "@/lib/types";

export const dynamic = "force-dynamic";

const ACTIONS: ActionType[] = [
  "rollback",
  "scale_pool",
  "page_oncall",
  "open_channel",
  "disable_flag",
  "resolve",
  "provide_input",
  "escalate",
];

/** Human and comms events enter the platform here, then the orchestrator fans them out. */
export async function POST(req: Request) {
  const body = (await req.json()) as { incidentId?: string; type?: ActionType };
  if (!body.incidentId || !body.type || !ACTIONS.includes(body.type)) {
    return NextResponse.json({ error: "invalid gateway event" }, { status: 400 });
  }
  try {
    const rec = getStore().act(body.incidentId, body.type);
    return NextResponse.json({
      ok: true,
      via: "incident-gateway",
      action: rec,
      pipeline: getStore().snapshot().pipeline,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export function GET() {
  const state = getStore().snapshot();
  return NextResponse.json({
    gateway: state.pipeline?.gateway ?? null,
    ingest: state.pipeline?.ingest ?? [],
  });
}
