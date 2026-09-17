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
];

export async function POST(req: Request) {
  const body = (await req.json()) as { incidentId?: string; type?: ActionType };
  if (!body.incidentId || !body.type || !ACTIONS.includes(body.type)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  try {
    const rec = getStore().act(body.incidentId, body.type);
    return NextResponse.json({ ok: true, action: rec, state: getStore().snapshot() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
