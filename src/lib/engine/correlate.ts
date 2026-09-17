import { DEPLOY_AT, INCIDENT_AT } from "../clock";
import type {
  Correlation,
  Deployment,
  Evidence,
  Hypothesis,
  Investigation,
  LogEvent,
  MetricSample,
  Service,
} from "../types";
import { computeBlastRadius } from "./blast-radius";
import { baselineMetrics, latestMetrics } from "./detect";

function clamp(n: number, min = 0, max = 0.99) {
  return Math.min(max, Math.max(min, n));
}

export function investigate(input: {
  now: number;
  services: Service[];
  metrics: MetricSample[];
  deployments: Deployment[];
  logs: LogEvent[];
  affectedServiceIds: string[];
  rollbackApplied: boolean;
  mitigationApplied: boolean;
}): Investigation {
  const last = latestMetrics(input.metrics);
  const base = baselineMetrics(input.metrics, input.now);
  const deploy = input.deployments.find((d) => d.id === "dep-payments-2814") ?? input.deployments[0];
  const lagMin = (INCIDENT_AT - DEPLOY_AT) / 60_000;
  const poolLogs = input.logs.filter((l) =>
    /pool|timeout|connection|too many clients/i.test(l.message),
  ).length;

  const deployStatus = deploy?.status;
  const deployLive = deployStatus === "success" || deployStatus === "in_progress";

  const deployConfidence = clamp(
    (deployLive ? 0.58 : 0.12) +
      (lagMin >= 1 && lagMin <= 15 ? 0.16 : 0) +
      (poolLogs >= 6 ? 0.1 : 0.04) +
      (last.dbConnections > base.dbConnections * 1.5 ? 0.07 : 0) -
      (input.rollbackApplied ? 0.55 : 0) -
      (input.mitigationApplied ? 0.08 : 0),
  );

  const trafficConfidence = clamp(
    0.12 + (last.rps > 4200 ? 0.15 : 0.04) - (input.rollbackApplied ? 0.02 : 0),
  );
  const infraConfidence = clamp(
    0.08 + (last.dbConnections > 200 ? 0.1 : 0) - (input.rollbackApplied ? 0.03 : 0),
  );

  const hypotheses: Hypothesis[] = [
    {
      id: "h-deploy",
      kind: "deploy",
      title: `Deployment ${deploy?.version ?? "v2.8.14"} on Payments API`,
      confidence: deployConfidence,
      rationale: `Error spike began ${lagMin.toFixed(0)}m after ${deploy?.version ?? "v2.8.14"} landed. Commit ${deploy?.commit ?? "a1f3c2d"} eagerly checks out a Postgres client per payment intent, saturating the shared pool used by Auth.`,
    },
    {
      id: "h-traffic",
      kind: "traffic",
      title: "Organic traffic surge",
      confidence: trafficConfidence,
      rationale:
        "RPS is within 8% of the morning baseline. This does not explain a 27% failure rate or the connection-pool errors.",
    },
    {
      id: "h-infra",
      kind: "infra",
      title: "Postgres hardware saturation",
      confidence: infraConfidence,
      rationale:
        "CPU and disk on payments-db are elevated as a symptom of client wait, not a primary hardware fault. No AZ event on the status board.",
    },
  ];
  hypotheses.sort((a, b) => b.confidence - a.confidence);

  const selected = hypotheses[0];

  const correlations: Correlation[] = [
    {
      id: "c1",
      left: "Deploy v2.8.14",
      right: "Error-rate cliff at 10:42",
      strength: 0.93,
      note: "4 minute lag, classic bad-change signature.",
    },
    {
      id: "c2",
      left: "DB connections +90%",
      right: "Auth + Payments 500s",
      strength: 0.88,
      note: "Both services share cluster pg-payments-main. Auth is collateral, not the actor.",
    },
    {
      id: "c3",
      left: "pool timeout logs",
      right: "Crash rate +180%",
      strength: 0.74,
      note: "Workers restart after checkout wait exceeds the 5s budget.",
    },
  ];

  const evidence: Evidence[] = [
    {
      id: "e1",
      source: "deploy",
      title: "payments-api v2.8.14",
      detail: `${deploy?.author ?? "Priya Nair"} · ${deploy?.message ?? "eager connection checkout"}`,
      ts: DEPLOY_AT,
    },
    {
      id: "e2",
      source: "git",
      title: "src/db/pool.ts",
      detail: "Pool min raised 4 → 24 and checkout moved onto the hot payment-intent path.",
      ts: DEPLOY_AT,
    },
    {
      id: "e3",
      source: "metrics",
      title: "Error rate vs baseline",
      detail: `Payments error rate ${last.errorRate.toFixed(1)}% vs ${base.errorRate.toFixed(1)}% baseline.`,
      ts: input.now,
    },
    {
      id: "e4",
      source: "logs",
      title: "remaining connection slots are reserved",
      detail: `${poolLogs} matching timeout / pool errors in the last 20 minutes.`,
      ts: input.now,
    },
    {
      id: "e5",
      source: "topology",
      title: "Shared data plane",
      detail: "auth-api → session-redis + payments-db. payments-api → payments-db. No isolation.",
    },
  ];

  const blastRadius = computeBlastRadius(
    input.services,
    input.affectedServiceIds,
    last.errorRate,
  );

  let likelyCause = `Deployment ${deploy?.version ?? "v2.8.14"}`;
  let recommendedAction = `Roll back ${deploy?.version ?? "v2.8.14"}`;
  let summary =
    "Payments API v2.8.14 exhausted the shared Postgres pool. Auth is failing as collateral. Highest-confidence fix is an immediate rollback to v2.8.13.";

  if (input.rollbackApplied && last.errorRate < 3) {
    likelyCause = "Deployment v2.8.14 (rolled back)";
    recommendedAction = "Monitor recovery, then resolve";
    summary =
      "Rollback to v2.8.13 restored pool headroom. Error rate and latency are returning to baseline. Stay in monitoring until Auth and Payments are healthy for 5 minutes.";
  } else if (input.mitigationApplied && !input.rollbackApplied) {
    recommendedAction = "Roll back v2.8.14 (still required)";
    summary =
      "Raising the pool cap reduced queueing, but the bad checkout pattern in v2.8.14 is still live. Rollback remains the corrective action.";
  }

  return {
    summary,
    hypotheses,
    selectedHypothesisId: selected.id,
    correlations,
    blastRadius,
    evidence,
    confidence: selected.confidence,
    likelyCause,
    recommendedAction,
  };
}
