import { formatDuration } from "../format";
import type { Incident, Postmortem } from "../types";

export function buildPostmortem(incident: Incident, now: number): Postmortem {
  const end = incident.resolvedAt ?? now;
  const durationMin = Math.max(1, Math.round((end - incident.startedAt) / 60_000));
  const detectLag = Math.round((incident.detectedAt - incident.startedAt) / 1000);

  return {
    incidentId: incident.id,
    title: incident.title,
    severity: incident.severity,
    durationMin,
    summary: `${incident.id} was a ${incident.severity} lasting ${durationMin} minutes. ${incident.brief.summary}`,
    impact: `${incident.brief.impact}. Blast radius peaked near ${incident.brief.users.toLocaleString()} users on the payments path.`,
    timeline: incident.timeline,
    rootCause:
      "Payments API v2.8.14 moved Postgres checkout onto the payment-intent hot path and raised pool minimums. The shared cluster pg-payments-main ran out of slots. Auth API, which borrows the same cluster for session writes, failed collaterally.",
    detection: `Commander opened the incident ${detectLag}s after the error cliff. Correlation against deploys, pool metrics, and logs reached ${(incident.brief.confidence * 100).toFixed(0)}% confidence on the bad change.`,
    response: incident.rollbackApplied
      ? `Rollback of v2.8.14 was executed. Total incident duration ${formatDuration(end - incident.startedAt)}.`
      : "Rollback was recommended and not yet recorded as completed.",
    wentWell: [
      "Detection attached the error cliff to a deploy inside four minutes.",
      "Blast-radius math correctly marked Auth as collateral rather than a second independent failure.",
      "Commander brief named a single corrective action instead of a list of guesses.",
    ],
    wentPoorly: [
      "Auth and Payments share a Postgres cluster without pool isolation.",
      "No canary gate on connection-pool utilization before full bake.",
      "Checkout path had no load-test covering eager client acquisition.",
    ],
    actionItems: [
      { owner: "Payments", item: "Isolate connection pools per service; cap min clients on the hot path." },
      { owner: "SRE", item: "Page on pool utilization > 70% and block deploys that raise min clients without a canary." },
      { owner: "Auth", item: "Move session writes off pg-payments-main onto the session store." },
      { owner: "Platform", item: "Add deploy-correlation to the default SEV-1 runbook." },
    ],
  };
}
