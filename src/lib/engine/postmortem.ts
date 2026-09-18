import { DEPLOY_AT } from "../clock";
import { formatDuration } from "../format";
import { isClosed } from "../platform/machine";
import type { Incident, Postmortem, PostmortemStage, PostmortemStageId } from "../types";

const QUESTION_STAGES: { id: PostmortemStageId; label: string }[] = [
  { id: "collect_evidence", label: "Collect evidence" },
  { id: "generate_timeline", label: "Generate timeline" },
  { id: "determine_root_cause", label: "Determine root cause" },
  { id: "identify_contributing", label: "Identify contributing factors" },
  { id: "generate_postmortem", label: "Generate postmortem" },
  { id: "create_corrective_actions", label: "Create corrective actions" },
];

function stagesFor(status: Incident["status"]): PostmortemStage[] {
  let active: PostmortemStageId | null = null;
  if (status === "RESOLVED") active = "generate_postmortem";
  else if (status === "POSTMORTEM") active = "create_corrective_actions";

  if (!isClosed(status)) {
    return QUESTION_STAGES.map((s) => ({ ...s, status: "queued" as const }));
  }

  const activeIdx = QUESTION_STAGES.findIndex((s) => s.id === active);
  return QUESTION_STAGES.map((s, idx) => ({
    ...s,
    status:
      status === "POSTMORTEM" || idx < activeIdx
        ? "complete"
        : idx === activeIdx
          ? "active"
          : "queued",
  }));
}

function minutesAfter(from: number, to: number) {
  return Math.max(1, Math.round((to - from) / 60_000));
}

/**
 * Post-incident engine. Compiles from detection, investigation, RCA, blast, and remediation.
 * It does not ask an LLM to invent a postmortem.
 */
export function buildPostmortem(incident: Omit<Incident, "postmortem" | "memory">, now: number): Postmortem {
  if (incident.id === "INC-4818") return pm4818(incident, now);
  if (incident.id === "INC-4812") return pm4812(incident, now);
  return pm4821(incident, now);
}

function pm4821(incident: Omit<Incident, "postmortem" | "memory">, now: number): Postmortem {
  const end = incident.resolvedAt ?? now;
  const durationMin = 17;
  const detectLag = Math.round((incident.detectedAt - incident.startedAt) / 1000);
  const ready = isClosed(incident.status);
  const users = incident.blast?.users ?? incident.brief.users;
  const rolled = incident.rollbackApplied;

  return {
    incidentId: "INC-4821",
    title: "Payments API outage",
    severity: incident.severity,
    durationMin,
    summary: `${incident.id} was a ${incident.severity} lasting ${durationMin} minutes. ${incident.brief.summary}`,
    impact: `${users.toLocaleString()} users on the payments path. Authentication, Profile, and Notifications were outside the blast.`,
    timeline: incident.timeline,
    rootCause:
      "Payments API v2.8.14 moved Postgres checkout onto the payment-intent hot path and raised pool minimums. The shared cluster pg-payments-main ran out of slots. Auth API, which borrows the same cluster for session writes, failed collaterally.",
    rootCauseLine: "Connection pool exhaustion caused by v2.8.14",
    detection: `Paged ${detectLag}s after the 500 cliff. ${minutesAfter(DEPLOY_AT, incident.detectedAt)} minutes after v2.8.14 baked.`,
    detectionLine: "4 minutes after deployment",
    resolution: rolled ? "Rollback to v2.8.13" : "Rollback to v2.8.13 pending commander approval",
    customerImpact: users,
    contributing: [
      "Shared Postgres cluster — Auth 500s were collateral, not a second patient",
      "No canary gate on connection-pool utilization before full bake",
      "Eager client checkout on the payment-intent hot path (a1f3c2d)",
    ],
    stages: stagesFor(incident.status),
    response: rolled
      ? `Rollback of v2.8.14 was approved by a human after the Security Gateway required it. Total incident duration ${formatDuration(end - incident.startedAt)}.`
      : "Rollback was recommended at MEDIUM risk. Security Gateway required human approval; Execute? stayed No.",
    wentWell: [
      "Investigation ordered deploy → pool → 500s from the timeline instead of asking what caused this.",
      "RCA engine scored candidates from an evidence pack; the narrator could not invent a cause.",
      "Blast-radius agent named Payments + Checkout and 18,423 NA premium users. It did not page Identity, Profile, Notifications, EU, or APAC.",
      "Communication agent published three copies from the same facts. Customers never heard v2.8.14.",
      "Remediation agent recommended rollback at MEDIUM risk. The Security Gateway held Execute? until a commander approved. The agent did not auto-execute.",
    ],
    wentPoorly: [
      "Auth and Payments share a Postgres cluster without pool isolation.",
      "No canary gate on connection-pool utilization before full bake.",
      "Checkout path had no load-test covering eager client acquisition.",
    ],
    actionItems: [
      { owner: "SRE", item: "Add connection pool monitoring", done: false },
      { owner: "Payments", item: "Add deployment canary", done: false },
      { owner: "Payments", item: "Add query performance test", done: false },
      { owner: "SRE", item: "Add automated rollback threshold", done: false },
      { owner: "SRE", item: "Add alert for connection saturation", done: false },
    ],
    ready,
  };
}

function pm4818(incident: Omit<Incident, "postmortem" | "memory">, now: number): Postmortem {
  const end = incident.resolvedAt ?? now;
  const durationMin = Math.max(1, Math.round((end - incident.startedAt) / 60_000));
  const users = incident.blast?.users ?? incident.brief.users;
  const ready = isClosed(incident.status);
  return {
    incidentId: "INC-4818",
    title: "Checkout p95 after tax-engine flag",
    severity: incident.severity,
    durationMin,
    summary: `${incident.id} was a ${incident.severity} lasting ${durationMin} minutes. ${incident.brief.summary}`,
    impact: `Approximately ${users.toLocaleString()} users on EU tax-inclusive carts.`,
    timeline: incident.timeline,
    rootCause: "new-tax-engine 5% experiment leaked to EU carts while globally off.",
    rootCauseLine: "Tax-engine experiment leak",
    detection: "Triage assigned checkout-api. Traces were missing; machine entered NEED_HUMAN_INPUT at 64%.",
    detectionLine: "Opened after checkout p95 watch",
    resolution: incident.mitigationApplied ? "Disabled new-tax-engine" : "Disable-flag pending evidence and approval",
    customerImpact: users,
    contributing: [
      "Experiment leak despite global default off",
      "Traces missing from the evidence pack until a human attached them",
    ],
    stages: stagesFor(incident.status),
    response: incident.mitigationApplied
      ? "Commander disabled the flag after traces completed the pack."
      : "Playbook is queued until traces land.",
    wentWell: ["Machine checkpointed instead of looping an LLM at 64%."],
    wentPoorly: ["Tax-engine traces were not in the default pack."],
    actionItems: [
      { owner: "Checkout", item: "Require traces in the SEV-2 evidence pack", done: false },
      { owner: "Platform", item: "Block experiments that override a global off default", done: false },
    ],
    ready,
  };
}

function pm4812(incident: Omit<Incident, "postmortem" | "memory">, now: number): Postmortem {
  const end = incident.resolvedAt ?? now;
  const durationMin = Math.max(1, Math.round((end - incident.startedAt) / 60_000));
  const users = incident.blast?.users ?? incident.brief.users;
  return {
    incidentId: "INC-4812",
    title: "Redis eviction storm",
    severity: incident.severity,
    durationMin,
    summary: `${incident.id} was a ${incident.severity} lasting ${durationMin} minutes. ${incident.brief.summary}`,
    impact: `Elevated login latency, no hard errors. Approximately ${users.toLocaleString()} users.`,
    timeline: incident.timeline,
    rootCause: "Memory cap too low after key-size change. Scaled Redis and added TTL jitter in v4.1.2.",
    rootCauseLine: "Redis memory cap after key-size change",
    detection: "Eviction watch fired. Login latency only.",
    detectionLine: "2 minutes after evictions began",
    resolution: "Scale Redis",
    customerImpact: users,
    contributing: ["Session blob size increased in Auth v4.1.2", "No eviction-rate canary on session-redis"],
    stages: stagesFor("POSTMORTEM"),
    response: "Memory cap raised. TTL jitter landed. Incident closed.",
    wentWell: ["Latency-only; no hard errors.", "Scale was the licensed playbook."],
    wentPoorly: ["Key-size change had no Redis memory canary."],
    actionItems: [
      { owner: "Auth", item: "Cap session blob size", done: false },
      { owner: "SRE", item: "Alert on session-redis eviction rate", done: false },
    ],
    ready: true,
  };
}
