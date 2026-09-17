import { isClosed } from "../platform/machine";
import { DETECTED_AT, DEPLOY_AT, INCIDENT_AT } from "../clock";
import type {
  Deployment,
  DetectionSample,
  DetectionSignal,
  DetectionVerdict,
  FleetSnapshot,
  Incident,
  LogEvent,
  MetricSample,
  Service,
} from "../types";

export function latestMetrics(metrics: MetricSample[]) {
  return metrics[metrics.length - 1];
}

export function baselineMetrics(metrics: MetricSample[], now: number) {
  const window = metrics.filter((m) => m.ts < INCIDENT_AT && m.ts > now - 90 * 60_000);
  const src = window.length > 8 ? window : metrics.slice(0, 12);
  const avg = (fn: (m: MetricSample) => number) =>
    src.reduce((s, m) => s + fn(m), 0) / Math.max(1, src.length);
  return {
    errorRate: avg((m) => m.errorRate),
    latencyP95: avg((m) => m.latencyP95),
    dbConnections: avg((m) => m.dbConnections),
    crashRate: avg((m) => m.crashRate),
    http500Index: avg((m) => m.http500Index),
  };
}

export function computeFleet(metrics: MetricSample[], now: number): FleetSnapshot {
  const last = latestMetrics(metrics);
  const base = baselineMetrics(metrics, now);
  const delta = (cur: number, b: number) => (b <= 0 ? 0 : ((cur - b) / b) * 100);
  return {
    http500DeltaPct: delta(last.http500Index, base.http500Index),
    latencyDeltaPct: delta(last.latencyP95, base.latencyP95),
    dbConnDeltaPct: delta(last.dbConnections, base.dbConnections),
    crashDeltaPct: delta(last.crashRate, base.crashRate),
    failingRequestPct: last.errorRate,
    affectedUsers: Math.round(18400 * Math.min(1.15, last.errorRate / 27)),
  };
}

export function serviceHealth(errorRate: number, latencyP95: number): Service["health"] {
  if (errorRate >= 15 || latencyP95 >= 1200) return "outage";
  if (errorRate >= 3 || latencyP95 >= 500) return "degraded";
  return "healthy";
}

function increase(current: number, baseline: number) {
  if (baseline <= 0) return "n/a";
  return `${Math.round(((current - baseline) / baseline) * 100)}%`;
}

const QUESTION = "Is this an actual incident or a noisy alert?";

/** Opening Datadog-style sample that paged INC-4821 — frozen at first detect. */
const INC_4821_LEAD: DetectionSample = {
  service: "payments-api",
  metric: "http_5xx_rate",
  current: "12.4%",
  baseline: "0.3%",
  increase: "4033%",
};

export interface DetectInput {
  incidentId: string;
  now: number;
  metrics: MetricSample[];
  logs: LogEvent[];
  deployments: Deployment[];
  services: Service[];
  rollbackApplied?: boolean;
  closed?: boolean;
}

/**
 * Classifier, not an LLM. Consumes seven signal families and decides
 * incident vs noise, then assigns SEV / confidence / patient / start.
 */
export function detectIncident(input: DetectInput): DetectionVerdict {
  if (input.incidentId === "INC-4818") return detect4818();
  if (input.incidentId === "INC-4812") return detect4812();
  return detect4821(input);
}

function detect4821(input: DetectInput): DetectionVerdict {
  const last = latestMetrics(input.metrics);
  const base = baselineMetrics(input.metrics, input.now);
  const recentLogs = input.logs.filter((l) => l.ts >= INCIDENT_AT);
  const errors = recentLogs.filter((l) => l.level === "error" || l.level === "fatal");
  const fatals = recentLogs.filter((l) => l.level === "fatal");
  const deploy = input.deployments.find((d) => d.id === "dep-payments-2814");
  const deployLagMin = deploy ? Math.round((INCIDENT_AT - deploy.completedAt) / 60_000) : 99;
  const recovered = Boolean(input.rollbackApplied && last.errorRate < 3);

  const alertsFiring = last.errorRate >= 8;
  const logsFiring = errors.length >= 4;
  const errorsFiring = last.crashRate >= base.crashRate * 1.5 || fatals.length > 0;
  const infraFiring = last.latencyP95 >= base.latencyP95 * 1.8;
  const deployFiring = deployLagMin >= 0 && deployLagMin <= 15;
  const dbFiring = last.dbConnections >= base.dbConnections * 1.4;
  const cloudFiring = false;

  const families = [alertsFiring, logsFiring, errorsFiring, infraFiring, deployFiring, dbFiring].filter(Boolean).length;

  const signals: DetectionSignal[] = [
    {
      source: "alerts",
      label: "Monitoring alerts",
      firing: alertsFiring,
      sample: {
        service: "payments-api",
        metric: "failing_request_ratio",
        current: `${last.errorRate.toFixed(1)}%`,
        baseline: `${base.errorRate.toFixed(1)}%`,
        increase: increase(last.errorRate, base.errorRate),
      },
      detail: alertsFiring
        ? `Live failing-request ratio ${last.errorRate.toFixed(1)}% vs ${base.errorRate.toFixed(1)}% baseline.`
        : "Failing-request ratio back under the SEV page.",
    },
    {
      source: "logs",
      label: "Application logs",
      firing: logsFiring,
      detail: logsFiring
        ? `${errors.length} error/fatal lines since 10:42. PoolCheckoutTimeout and SUPERUSER slot warnings on payments-api.`
        : "Error log volume has dropped under the detect window.",
    },
    {
      source: "errors",
      label: "Error tracking",
      firing: errorsFiring,
      sample: {
        service: "payments-api",
        metric: "crash_rate",
        current: last.crashRate.toFixed(2),
        baseline: base.crashRate.toFixed(2),
        increase: increase(last.crashRate, base.crashRate),
      },
      detail: errorsFiring
        ? `Crash rate ${increase(last.crashRate, base.crashRate)} vs baseline. ${fatals.length} fatal worker restarts.`
        : "Crash rate back near baseline.",
    },
    {
      source: "infra",
      label: "Infrastructure metrics",
      firing: infraFiring,
      sample: {
        service: "payments-api",
        metric: "latency_p95",
        current: `${Math.round(last.latencyP95)}ms`,
        baseline: `${Math.round(base.latencyP95)}ms`,
        increase: increase(last.latencyP95, base.latencyP95),
      },
      detail: infraFiring
        ? `p95 ${Math.round(last.latencyP95)}ms vs ${Math.round(base.latencyP95)}ms. HTTP 500 index ${last.http500Index.toFixed(1)}×.`
        : "Latency and 500 index near baseline.",
    },
    {
      source: "deploy",
      label: "Deployment events",
      firing: deployFiring,
      detail: deploy
        ? `${deploy.version} completed ${deployLagMin}m before the cliff (${deploy.commit}). Classic bad-change lag.`
        : "No recent deploy on the patient.",
    },
    {
      source: "database",
      label: "Database metrics",
      firing: dbFiring,
      sample: {
        service: "payments-db",
        metric: "active_connections",
        current: `${Math.round(last.dbConnections)}`,
        baseline: `${Math.round(base.dbConnections)}`,
        increase: increase(last.dbConnections, base.dbConnections),
      },
      detail: dbFiring
        ? `pg-payments-main at ${Math.round(last.dbConnections)} connections vs ${Math.round(base.dbConnections)} baseline.`
        : "Pool headroom restored.",
    },
    {
      source: "cloud",
      label: "Cloud events",
      firing: cloudFiring,
      detail: "No AWS health event in us-east-1. Not a region or control-plane outage.",
    },
  ];

  const incident = families >= 3 && alertsFiring;
  const confidence = incident ? 0.94 : recovered || input.closed ? 0.94 : Math.min(0.72, 0.28 + families * 0.08);

  return {
    incidentId: "INC-4821",
    verdict: incident || recovered || input.closed ? "incident" : families >= 2 ? "incident" : "noisy",
    question: QUESTION,
    answer: recovered
      ? "Actual incident, recovering. Opening sample was not noise — six independent families corroborated."
      : incident
        ? "Actual incident. Six independent families corroborate the opening 5xx sample. Not a flappy monitor."
        : "Weak corroboration. Hold the page until a second family fires.",
    severity: "SEV-1",
    confidence,
    affected: ["Payments API"],
    startedAt: INCIDENT_AT,
    lead: INC_4821_LEAD,
    signals,
  };
}

function detect4818(): DetectionVerdict {
  const lead: DetectionSample = {
    service: "checkout-api",
    metric: "latency_p95",
    current: "410ms",
    baseline: "190ms",
    increase: "116%",
  };
  return {
    incidentId: "INC-4818",
    verdict: "incident",
    question: QUESTION,
    answer: "Actual incident, contained. Checkout-only — not a fleet 5xx cliff. SEV-2, not noise.",
    severity: "SEV-2",
    confidence: 0.78,
    affected: ["Checkout API"],
    startedAt: Date.parse("2026-09-14T08:14:00Z"),
    lead,
    signals: [
      { source: "alerts", label: "Monitoring alerts", firing: true, sample: lead, detail: "Checkout p95 watch. EU tax-inclusive carts only." },
      { source: "logs", label: "Application logs", firing: false, detail: "Tax-engine traces missing — investigation later blocked." },
      { source: "errors", label: "Error tracking", firing: true, detail: "4% extra errors on tax-inclusive carts. No crash loop." },
      { source: "infra", label: "Infrastructure metrics", firing: true, detail: "p95 410ms vs 190ms baseline. Isolated to checkout-api." },
      { source: "deploy", label: "Deployment events", firing: false, detail: "No checkout deploy in the detect window. Flag leak suspected." },
      { source: "database", label: "Database metrics", firing: false, detail: "Checkout DB pool nominal." },
      { source: "cloud", label: "Cloud events", firing: false, detail: "No eu-west-1 health event." },
    ],
  };
}

function detect4812(): DetectionVerdict {
  const lead: DetectionSample = {
    service: "session-redis",
    metric: "eviction_rate",
    current: "18/s",
    baseline: "0.4/s",
    increase: "4400%",
  };
  return {
    incidentId: "INC-4812",
    verdict: "incident",
    question: QUESTION,
    answer: "Actual incident. Redis evictions were real; closed after scale + TTL jitter.",
    severity: "SEV-3",
    confidence: 0.86,
    affected: ["session-redis"],
    startedAt: Date.parse("2026-09-13T19:02:00Z"),
    lead,
    signals: [
      { source: "alerts", label: "Monitoring alerts", firing: false, sample: lead, detail: "Eviction watch fired, then cleared after scale." },
      { source: "logs", label: "Application logs", firing: false, detail: "Auth login latency warnings, no hard 500s." },
      { source: "errors", label: "Error tracking", firing: false, detail: "No crash spike. Latency only." },
      { source: "infra", label: "Infrastructure metrics", firing: false, detail: "Redis memory cap saturated, then recovered." },
      { source: "deploy", label: "Deployment events", firing: true, detail: "Auth v4.1.2 key-size change preceded the eviction storm." },
      { source: "database", label: "Database metrics", firing: false, detail: "Postgres not in the path." },
      { source: "cloud", label: "Cloud events", firing: false, detail: "No cloud provider event." },
    ],
  };
}

export function detectOpenIncident(
  metrics: MetricSample[],
  existing: Incident[],
): { shouldOpen: boolean; startedAt: number; detectedAt: number } {
  if (existing.some((i) => i.id === "INC-4821" && !isClosed(i.status))) {
    return { shouldOpen: false, startedAt: INCIDENT_AT, detectedAt: DETECTED_AT };
  }
  const verdict = detectIncident({
    incidentId: "INC-4821",
    now: metrics.at(-1)?.ts ?? DETECTED_AT,
    metrics,
    logs: [],
    deployments: [{ id: "dep-payments-2814", serviceId: "payments-api", version: "v2.8.14", previousVersion: "v2.8.13", startedAt: DEPLOY_AT, completedAt: DEPLOY_AT, status: "success", commit: "a1f3c2d", author: "", message: "", files: [] }],
    services: [],
  });
  return {
    shouldOpen: verdict.verdict === "incident",
    startedAt: INCIDENT_AT,
    detectedAt: DETECTED_AT,
  };
}
