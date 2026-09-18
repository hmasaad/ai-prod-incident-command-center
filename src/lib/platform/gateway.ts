import {
  COMPLAINTS_AT,
  DB_CPU_AT,
  DEPLOY_AT,
  INCIDENT_AT,
  LATENCY_AT,
} from "../clock";
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
    reject_remediation: {
      source: "human",
      title: "Commander rejected playbook",
      detail: "Gateway recorded the reject. Remediation agent will not execute.",
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
  const events = [
    makeGatewayEvent(DEPLOY_AT, "deploy", "Deployment v2.8.14", "Payments API baked to 100% after green canaries."),
    makeGatewayEvent(DB_CPU_AT, "database", "Database CPU begins increasing", "pg-payments-main CPU and connections leave baseline."),
    makeGatewayEvent(LATENCY_AT, "metrics", "API latency increases", "Payments authorize p95 leaves 178ms. Pool wait in traces."),
    makeGatewayEvent(INCIDENT_AT, "alerts", "HTTP 500 spike", "Failing-request ratio cliffs. Detection will page SEV-1."),
    makeGatewayEvent(COMPLAINTS_AT, "slack", "Customer complaints", "Support: payment failed. Downstream of the 500s, not a cause."),
    makeGatewayEvent(INCIDENT_AT + 62_000, "alerts", "http_5xx_rate 12.4% vs 0.3%", "Detection agent consumed payments-api sample (+4033%)."),
    makeGatewayEvent(now - 21 * 60_000, "slack", "Commander attached", "Communication agent: Maya Chen IC · Jordan Blake comms."),
  ];
  return events.filter((e) => e.ts <= now).sort((a, b) => b.ts - a.ts);
}

export function pushIngest(existing: GatewayEvent[], event: GatewayEvent, cap = 12) {
  return [event, ...existing.filter((e) => e.id !== event.id)].slice(0, cap);
}
