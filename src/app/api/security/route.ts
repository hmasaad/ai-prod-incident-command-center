import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { COMMANDER, REMEDIATION_AGENT, authorize } from "@/lib/platform/security";
import type { SecurityIntentKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const INTENTS: SecurityIntentKind[] = [
  "rollback",
  "restart",
  "scale",
  "disable_flag",
  "delete_database",
  "production_secret_access",
];

/** Inspect or probe the Security Gateway. Probes never execute. */
export function GET() {
  const state = getStore().snapshot();
  return NextResponse.json({
    security: state.pipeline?.security ?? null,
    humanLoop: state.incidents.find((i) => i.id === state.pipeline?.incidentId)?.humanLoop ?? null,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    incidentId?: string;
    intent?: SecurityIntentKind;
    actor?: "human" | "agent";
  };
  if (!body.incidentId || !body.intent || !INTENTS.includes(body.intent)) {
    return NextResponse.json({ error: "invalid probe" }, { status: 400 });
  }
  const snap = getStore().snapshot();
  const incident = snap.incidents.find((i) => i.id === body.incidentId);
  if (!incident) return NextResponse.json({ error: "unknown incident" }, { status: 404 });
  const decision = authorize({
    now: snap.now,
    intent: body.intent,
    principal: body.actor === "human" ? COMMANDER : REMEDIATION_AGENT,
    remediation: incident.remediation,
  });
  return NextResponse.json({
    via: "security-gateway",
    executed: false,
    decision,
  });
}
