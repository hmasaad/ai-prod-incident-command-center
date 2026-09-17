import type { ActionType, GatewayEvent } from "../types";

let seq = 0;

export function makeGatewayEvent(
  ts: number,
  source: GatewayEvent["source"],
  title: string,
  detail: string,
): GatewayEvent {
  seq += 1;
  return { id: `gw-${seq}`, ts, source, title, detail };
}

export function ingestAction(ts: number, type: ActionType): GatewayEvent {
  const map: Record<ActionType, { source: GatewayEvent["source"]; title: string; detail: string }> = {
    rollback: {
      source: "human",
      title: "Commander approved rollback",
      detail: "Gateway accepted remediation intent for Payments API v2.8.14.",
    },
    scale_pool: {
      source: "human",
      title: "Mitigation: raise pool cap",
      detail: "Not a corrective action. Orchestrator keeps rollback on the critical path.",
    },
    page_oncall: {
      source: "slack",
      title: "Page payments on-call",
      detail: "Communication agent paging Priya Nair.",
    },
    open_channel: {
      source: "slack",
      title: "Open #inc-4821",
      detail: "Communication agent standing up Slack war room.",
    },
    disable_flag: {
      source: "human",
      title: "Disable feature flag",
      detail: "Gateway routed flag change to remediation agent.",
    },
    resolve: {
      source: "human",
      title: "Declare incident resolved",
      detail: "Machine → RESOLVED. Postmortem agent compiles from checkpoints.",
    },
    provide_input: {
      source: "human",
      title: "Human evidence attached",
      detail: "Investigation agent resumes from its last checkpoint.",
    },
    escalate: {
      source: "slack",
      title: "Incident escalated",
      detail: "Machine → ESCALATED. Next-level on-call paged.",
    },
  };
  const row = map[type];
  return makeGatewayEvent(ts, row.source, row.title, row.detail);
}

export function ingestTick(ts: number, errorRate: number, rollbackApplied: boolean): GatewayEvent {
  if (rollbackApplied && errorRate < 3) {
    return makeGatewayEvent(
      ts,
      "metrics",
      "Recovery sample",
      `Error rate ${errorRate.toFixed(1)}% — verification agent still watching.`,
    );
  }
  return makeGatewayEvent(
    ts,
    "metrics",
    "Telemetry tick",
    `Error rate ${errorRate.toFixed(1)}% · detection agent still on the cliff.`,
  );
}

export function seedIngest(now: number): GatewayEvent[] {
  return [
    makeGatewayEvent(now - 26 * 60_000, "deploy", "Deploy v2.8.14 completed", "Payments API baked to 100% after green canaries."),
    makeGatewayEvent(now - 25 * 60_000, "alerts", "http_5xx_rate 12.4% vs 0.3%", "Detection agent consumed payments-api sample (+4033%)."),
    makeGatewayEvent(now - 25 * 60_000, "logs", "PoolCheckoutTimeout burst", "Application logs on payments-api and auth-api."),
    makeGatewayEvent(now - 24 * 60_000, "errors", "Crash rate +180%", "Error tracking: worker restarts on payments-api-7b9c."),
    makeGatewayEvent(now - 24 * 60_000, "database", "pg-payments-main pool", "Active connections 148 vs 78 baseline."),
    makeGatewayEvent(now - 24 * 60_000, "cloud", "us-east-1 health", "No AWS event. Not a region outage."),
    makeGatewayEvent(now - 25 * 60_000, "alerts", "INC-4821 opened · SEV-1", "Actual incident, not noise. 94% · Payments API · 10:42."),
    makeGatewayEvent(now - 22 * 60_000, "metrics", "Pool + crash correlated", "Investigation agent attached logs and traces."),
    makeGatewayEvent(now - 21 * 60_000, "slack", "Commander attached", "Communication agent: Maya Chen IC · Jordan Blake comms."),
  ];
}

export function pushIngest(existing: GatewayEvent[], event: GatewayEvent, cap = 12) {
  return [event, ...existing.filter((e) => e.id !== event.id)].slice(0, cap);
}
