import {
  COMPLAINTS_AT,
  DB_CPU_AT,
  DEPLOY_AT,
  INCIDENT_AT,
  LATENCY_AT,
} from "../clock";
import type {
  CausalStep,
  Correlation,
  Deployment,
  Evidence,
  Hypothesis,
  Investigation,
  InvestigationBeat,
  LogEvent,
  MetricSample,
  Service,
} from "../types";
import { computeBlastRadius } from "./blast-radius";
import { baselineMetrics, latestMetrics } from "./detect";

function clamp(n: number, min = 0, max = 0.99) {
  return Math.min(max, Math.max(min, n));
}

const CHAIN_4821: CausalStep[] = [
  { id: "k1", title: "Deployment v2.8.14", detail: "Payments API baked to 100% after green canaries. Commit a1f3c2d." },
  { id: "k2", title: "New database query", detail: "Eager client checkout moved onto the payment-intent hot path (src/db/pool.ts)." },
  { id: "k3", title: "Connection pool exhaustion", detail: "pg-payments-main slots gone. Auth shares the cluster — collateral, not the actor." },
  { id: "k4", title: "API timeout", detail: "PoolCheckoutTimeout after 5000ms. Workers blow the request budget." },
  { id: "k5", title: "HTTP 500", detail: "Failing-request ratio cliffs. Detection pages SEV-1 at 10:42." },
  { id: "k6", title: "Payment failures", detail: "Checkout retries, support volume, ~18k users on the revenue path." },
];

function beats4821(now: number): InvestigationBeat[] {
  return (
    [
      {
        id: "b-deploy",
        at: DEPLOY_AT,
        title: "Deployment v2.8.14",
        detail: "Payments API v2.8.14 at 100%. Canaries were green; bake did not watch pool utilization.",
        source: "deploy" as const,
      },
      {
        id: "b-db",
        at: DB_CPU_AT,
        title: "Database CPU begins increasing",
        detail: "pg-payments-main CPU and active connections leave the morning baseline.",
        source: "database" as const,
      },
      {
        id: "b-lat",
        at: LATENCY_AT,
        title: "API latency increases",
        detail: "Payments authorize p95 leaves 178ms. Pool wait shows up in traces before 500s.",
        source: "infra" as const,
      },
      {
        id: "b-500",
        at: INCIDENT_AT,
        title: "HTTP 500 spike",
        detail: "Failing-request ratio cliffs. Auth 500s follow ~20s later on the shared pool.",
        source: "alerts" as const,
      },
      {
        id: "b-cust",
        at: COMPLAINTS_AT,
        title: "Customer complaints",
        detail: "Support: payment failed. Comms starts the customer status. This is effect, not cause.",
        source: "comms" as const,
      },
    ] satisfies InvestigationBeat[]
  ).filter((b) => b.at <= now);
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
      (lagMin >= 1 && lagMin <= 20 ? 0.16 : 0) +
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
      rationale: `Ordered timeline: deploy 10:31 → DB CPU 10:35 → latency 10:39 → 500s 10:42. Commit ${deploy?.commit ?? "a1f3c2d"} eagerly checks out a Postgres client per payment intent.`,
    },
    {
      id: "h-traffic",
      kind: "traffic",
      title: "Organic traffic surge",
      confidence: trafficConfidence,
      rationale:
        "RPS is within 8% of the morning baseline. This does not explain pool exhaustion or the ordered precursor ramps.",
    },
    {
      id: "h-infra",
      kind: "infra",
      title: "Postgres hardware saturation",
      confidence: infraConfidence,
      rationale:
        "CPU is up as a symptom of client wait from the new query, not a primary hardware fault. No AZ event.",
    },
  ];
  hypotheses.sort((a, b) => b.confidence - a.confidence);

  const selected = hypotheses[0];

  const correlations: Correlation[] = [
    {
      id: "c1",
      left: "Deploy v2.8.14 @ 10:31",
      right: "DB CPU @ 10:35",
      strength: 0.91,
      note: "Four minutes after bake. New query on the hot path, not a coincidence.",
    },
    {
      id: "c2",
      left: "DB CPU / pool",
      right: "API latency @ 10:39",
      strength: 0.89,
      note: "Latency moves before 500s — checkout wait, then timeouts.",
    },
    {
      id: "c3",
      left: "API timeout",
      right: "HTTP 500 @ 10:42",
      strength: 0.94,
      note: "PoolCheckoutTimeout 5000ms maps onto the failing-request cliff.",
    },
    {
      id: "c4",
      left: "HTTP 500",
      right: "Customer complaints @ 10:44",
      strength: 0.8,
      note: "Complaints are downstream. They do not cause the cliff.",
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
      title: "Ordered metric ramps",
      detail: `DB CPU then latency then 500s. Live error ${last.errorRate.toFixed(1)}% vs ${base.errorRate.toFixed(1)}% baseline.`,
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
    "Most likely causal chain: deploy v2.8.14 → new database query → pool exhaustion → API timeout → HTTP 500 → payment failures. Auth is collateral on the shared cluster.";

  if (input.rollbackApplied && last.errorRate < 3) {
    likelyCause = "Deployment v2.8.14 (rolled back)";
    recommendedAction = "Verify recovery, then resolve";
    summary =
      "Causal chain confirmed in reverse: rollback restored pool headroom, 500s and complaints fell. Stay in VERIFYING.";
  } else if (input.mitigationApplied && !input.rollbackApplied) {
    recommendedAction = "Roll back v2.8.14 (still required)";
    summary =
      "Raising the pool cap reduced queueing, but the new query in v2.8.14 is still live. The chain still points at rollback.";
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
    beats: beats4821(input.now),
    causalChain: CHAIN_4821,
  };
}
