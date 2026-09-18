import {
  CORRELATED_AT,
  INCIDENT_AT,
  INVESTIGATION_STARTED_AT,
  SATURATION_AT,
} from "../clock";
import type { HumanLoopBrief, Incident, MetricSample } from "../types";
import { baselineMetrics, latestMetrics } from "./detect";

/**
 * Commander-facing human-in-the-loop card.
 * This is the gate the Security Gateway is holding — not a second investigation.
 */
export function buildHumanLoop(incident: Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">, metrics: MetricSample[] = []): HumanLoopBrief {
  if (incident.id === "INC-4818") return loop4818(incident, metrics);
  if (incident.id === "INC-4812") return loop4812(incident);
  return loop4821(incident);
}

function loop4821(incident: Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">): HumanLoopBrief {
  const blast = incident.blast;
  const rem = incident.remediation;
  const pending = incident.status === "REMEDIATION_PENDING" && !rem.approved;
  return {
    incidentId: incident.id,
    severity: incident.severity,
    title: "Payments Production Incident",
    users: blast?.users ?? incident.brief.users,
    errorRate: incident.detection?.lead.current ?? "12.4%",
    latencyDelta: "+340%",
    startedAt: incident.startedAt,
    rootCause: "Deployment v2.8.14",
    confidence: incident.rca?.confidence ?? incident.brief.confidence,
    rootCauseDetail: "New database query appears to exhaust connection pool.",
    recommended: rem?.recommendation ?? "Rollback v2.8.14",
    expectedRecovery: "2–5 minutes",
    risk: rem?.risk ?? "MEDIUM",
    approveLabel: rem?.approveLabel ?? "Approve Rollback",
    actionType: rem?.actionType ?? "rollback",
    awaiting: pending,
    timeline: [
      { at: INCIDENT_AT, title: "Alert detected" },
      { at: INVESTIGATION_STARTED_AT, title: "Investigation started" },
      { at: CORRELATED_AT, title: "Deployment correlation found" },
      { at: SATURATION_AT, title: "DB saturation confirmed" },
    ],
  };
}

function loop4818(incident: Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">, metrics: MetricSample[]): HumanLoopBrief {
  const last = metrics.length ? latestMetrics(metrics) : null;
  const latencyDelta = last
    ? (() => {
        const base = baselineMetrics(metrics, last.ts);
        return base.latencyP95 <= 0
          ? "+0%"
          : `+${Math.round(((last.latencyP95 - base.latencyP95) / base.latencyP95) * 100)}%`;
      })()
    : "+0%";
  const pending = incident.status === "REMEDIATION_PENDING";
  const needHuman = incident.status === "NEED_HUMAN_INPUT" || incident.status === "ESCALATED";
  return {
    incidentId: incident.id,
    severity: incident.severity,
    title: "Checkout p95 elevated after tax-engine flag",
    users: incident.blast?.users ?? incident.brief.users,
    errorRate: incident.detection?.lead.current ?? (last ? `${last.errorRate.toFixed(1)}%` : "4.0%"),
    latencyDelta,
    startedAt: incident.startedAt,
    rootCause: incident.rca?.candidates[0]?.candidate ?? incident.investigation.likelyCause,
    confidence: incident.rca?.confidence ?? incident.investigation.confidence,
    rootCauseDetail: needHuman
      ? "Traces are missing. Confidence is below the 75% gate. The agent is checkpointed."
      : "Experiment leak on tax-inclusive carts. Disable the flag; do not roll the bake.",
    recommended: needHuman ? "Attach missing evidence" : incident.remediation.recommendation,
    expectedRecovery: "Minutes after the flag hits 0%.",
    risk: incident.remediation.risk,
    approveLabel: needHuman ? "Attach missing evidence" : incident.remediation.approveLabel,
    actionType: needHuman ? "provide_input" : incident.remediation.actionType,
    awaiting: pending || needHuman,
    timeline: incident.investigation.beats.slice(0, 4).map((b) => ({ at: b.at, title: b.title })),
  };
}

function loop4812(incident: Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">): HumanLoopBrief {
  return {
    incidentId: incident.id,
    severity: incident.severity,
    title: "Redis eviction storm on session-redis",
    users: incident.blast?.users ?? incident.brief.users,
    errorRate: "0.0%",
    latencyDelta: "+0%",
    startedAt: incident.startedAt,
    rootCause: incident.rca?.candidates[0]?.candidate ?? "Redis memory cap",
    confidence: incident.rca?.confidence ?? 0.86,
    rootCauseDetail: "Memory cap was the cause. Scale Redis already landed.",
    recommended: "Incident resolved",
    expectedRecovery: "Already recovered.",
    risk: "LOW",
    approveLabel: "Open postmortem",
    actionType: "resolve",
    awaiting: false,
    timeline: incident.investigation.beats.slice(0, 4).map((b) => ({ at: b.at, title: b.title })),
  };
}
