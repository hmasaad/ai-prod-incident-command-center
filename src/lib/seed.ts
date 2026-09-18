import {
  BLAST_AT,
  DAY,
  DB_CPU_AT,
  DEPLOY_AT,
  DETECTED_AT,
  INCIDENT_AT,
  INVESTIGATED_AT,
  LATENCY_AT,
  COMPLAINTS_AT,
  METRIC_START,
  METRIC_STEP,
  mulberry32,
  REMEDIATION_PENDING_AT,
  VIEWER_START,
} from "./clock";
import { investigate } from "./engine/correlate";
import { computeFleet, detectIncident, serviceHealth } from "./engine/detect";
import { analyzeBlast } from "./engine/blast-radius";
import { analyzeRca } from "./engine/rca";
import { analyzeRemediation } from "./engine/remediate";
import { buildHumanLoop } from "./engine/human-loop";
import { draftComms } from "./engine/comms";
import { buildPostmortem } from "./engine/postmortem";
import { recallMemory } from "./engine/memory";
import { seedMachine } from "./platform/machine";
import type {
  Deployment,
  Incident,
  LogEvent,
  MetricSample,
  Service,
  WorldState,
} from "./types";

export interface SimFlags {
  rollbackAt?: number;
  mitigateAt?: number;
  disableFlagAt?: number;
}

function finishIncident(incident: Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">): Incident {
  const humanLoop = buildHumanLoop(incident);
  const comms = draftComms({
    incidentId: incident.id,
    status: incident.status,
    severity: incident.severity,
    detection: incident.detection,
    rca: incident.rca,
    blast: incident.blast,
    remediation: incident.remediation,
    rollbackApplied: incident.rollbackApplied,
  });
  const draft = { ...incident, humanLoop, comms };
  const postmortem = buildPostmortem(draft, incident.detectedAt);
  return { ...draft, postmortem, memory: recallMemory({ ...draft, postmortem }, incident.detectedAt) };
}

function unitRamp(ts: number, start: number, duration: number) {
  if (ts < start) return 0;
  return Math.min(1, (ts - start) / Math.max(1, duration));
}

function metricAt(ts: number, flags: SimFlags, rand: () => number): MetricSample {
  const n = () => (rand() - 0.5) * 2;
  const recovered =
    flags.rollbackAt !== undefined && ts >= flags.rollbackAt + 3 * 60_000;
  const recovering =
    flags.rollbackAt !== undefined &&
    ts >= flags.rollbackAt &&
    ts < flags.rollbackAt + 3 * 60_000;
  const mitigated =
    flags.mitigateAt !== undefined &&
    ts >= flags.mitigateAt &&
    flags.rollbackAt === undefined;

  const dbWarm = recovered ? 0 : unitRamp(ts, DB_CPU_AT, INCIDENT_AT - DB_CPU_AT);
  const latWarm = recovered ? 0 : unitRamp(ts, LATENCY_AT, INCIDENT_AT - LATENCY_AT);
  const cliff = recovered ? 0 : unitRamp(ts, INCIDENT_AT, 2 * 60_000);

  let errorRate = 0.55 + n() * 0.08 + 26.5 * cliff;
  let latencyP95 = 178 + n() * 12 + 140 * latWarm + 307 * cliff;
  let dbConnections = 78 + n() * 6 + 40 * dbWarm + 30 * cliff;
  let dbCpu = 22 + n() * 1.4 + 28 * dbWarm + 18 * cliff;
  let crashRate = 0.22 + n() * 0.04 + 0.4 * cliff;
  let http500Index = 1 + n() * 0.05 + 3.4 * cliff;
  const rps = 1480 + n() * 40 - 180 * cliff;

  if (mitigated && ts >= INCIDENT_AT && !recovered) {
    errorRate = 7.8 + n() * 0.4;
    latencyP95 = 310 + n() * 16;
    dbConnections = 126 + n() * 5;
    dbCpu = 48 + n() * 2;
    crashRate = 0.35 + n() * 0.02;
    http500Index = 2.1 + n() * 0.06;
  }
  if (recovering) {
    const t = (ts - flags.rollbackAt!) / (3 * 60_000);
    errorRate = 27 * (1 - t) + 0.7 * t;
    latencyP95 = 625 * (1 - t) + 185 * t;
    dbConnections = 148 * (1 - t) + 80 * t;
    dbCpu = 68 * (1 - t) + 24 * t;
    crashRate = 0.62 * (1 - t) + 0.22 * t;
    http500Index = 4.4 * (1 - t) + 1 * t;
  }

  return { ts, errorRate, latencyP95, dbConnections, dbCpu, crashRate, http500Index, rps };
}

export function buildMetrics(now: number, flags: SimFlags): MetricSample[] {
  const rand = mulberry32(4821);
  const points: MetricSample[] = [];
  for (let ts = METRIC_START; ts <= now; ts += METRIC_STEP) {
    points.push(metricAt(ts, flags, rand));
  }
  return points;
}

export function baseServices(): Service[] {
  return [
    { id: "edge-cdn", name: "Edge CDN", layer: "edge", health: "healthy", errorRate: 0.1, latencyP95: 42, rps: 6200, owners: ["Platform"], dependsOn: ["api-gateway"], version: "edge-24" },
    { id: "api-gateway", name: "API Gateway", layer: "gateway", health: "healthy", errorRate: 0.2, latencyP95: 68, rps: 4100, owners: ["Platform"], dependsOn: ["auth-api", "checkout-api"], version: "gw-9.4.1" },
    { id: "auth-api", name: "Auth API", layer: "api", health: "degraded", errorRate: 14.2, latencyP95: 540, rps: 980, owners: ["Identity"], dependsOn: ["session-redis", "payments-db"], version: "v4.1.2" },
    { id: "payments-api", name: "Payments API", layer: "api", health: "outage", errorRate: 27.4, latencyP95: 630, rps: 620, owners: ["Payments"], dependsOn: ["payments-db", "kafka-events"], version: "v2.8.14" },
    { id: "checkout-api", name: "Checkout API", layer: "api", health: "degraded", errorRate: 4.1, latencyP95: 410, rps: 540, owners: ["Commerce"], dependsOn: ["payments-api", "inventory-api"], version: "v7.3.0" },
    { id: "profile-api", name: "Profile API", layer: "api", health: "healthy", errorRate: 0.2, latencyP95: 85, rps: 220, owners: ["Identity"], dependsOn: ["auth-api"], version: "v2.4.1" },
    { id: "inventory-api", name: "Inventory API", layer: "api", health: "healthy", errorRate: 0.4, latencyP95: 120, rps: 300, owners: ["Commerce"], dependsOn: ["payments-db"], version: "v3.9.8" },
    { id: "notify-api", name: "Notify API", layer: "api", health: "healthy", errorRate: 0.3, latencyP95: 90, rps: 150, owners: ["Comms"], dependsOn: ["kafka-events"], version: "v1.6.2" },
    { id: "payments-db", name: "payments-db", layer: "data", health: "degraded", errorRate: 0, latencyP95: 24, rps: 0, owners: ["SRE"], dependsOn: [], version: "pg-15.4" },
    { id: "session-redis", name: "session-redis", layer: "data", health: "healthy", errorRate: 0, latencyP95: 3, rps: 0, owners: ["SRE"], dependsOn: [], version: "redis-7.2" },
    { id: "kafka-events", name: "kafka-events", layer: "async", health: "healthy", errorRate: 0, latencyP95: 8, rps: 0, owners: ["Platform"], dependsOn: [], version: "k-3.7" },
  ];
}

export function applyServiceHealth(services: Service[], metrics: MetricSample[], flags: SimFlags): Service[] {
  const last = metrics[metrics.length - 1];
  return services.map((s) => {
    if (s.id === "payments-api") {
      const errorRate = last.errorRate;
      const latencyP95 = last.latencyP95;
      return {
        ...s,
        errorRate,
        latencyP95,
        health: serviceHealth(errorRate, latencyP95),
        version: flags.rollbackAt ? "v2.8.13" : "v2.8.14",
      };
    }
    if (s.id === "auth-api") {
      const errorRate = Math.max(0.4, last.errorRate * 0.52);
      const latencyP95 = 140 + last.latencyP95 * 0.62;
      return { ...s, errorRate, latencyP95, health: serviceHealth(errorRate, latencyP95) };
    }
    if (s.id === "checkout-api") {
      const errorRate = Math.max(0.3, last.errorRate * 0.16);
      const latencyP95 = 160 + last.latencyP95 * 0.4;
      return { ...s, errorRate, latencyP95, health: serviceHealth(errorRate, latencyP95) };
    }
    if (s.id === "payments-db") {
      const health = last.dbConnections > 130 ? "degraded" : "healthy";
      return { ...s, health, latencyP95: last.dbConnections > 130 ? 24 + (last.dbConnections - 78) * 0.4 : 8 };
    }
    return s;
  });
}

export function baseDeployments(): Deployment[] {
  return [
    {
      id: "dep-payments-2814",
      serviceId: "payments-api",
      version: "v2.8.14",
      previousVersion: "v2.8.13",
      startedAt: DEPLOY_AT - 4 * 60_000,
      completedAt: DEPLOY_AT,
      status: "success",
      commit: "a1f3c2d",
      author: "Priya Nair",
      message: "Eager connection checkout on payment intent path",
      files: ["src/db/pool.ts", "src/payments/intent.ts", "src/payments/retry.ts"],
    },
    {
      id: "dep-auth-412",
      serviceId: "auth-api",
      version: "v4.1.2",
      previousVersion: "v4.1.1",
      startedAt: DAY + (9 * 60 + 12) * 60_000,
      completedAt: DAY + (9 * 60 + 18) * 60_000,
      status: "success",
      commit: "9c81ee0",
      author: "Luis Ortega",
      message: "Session TTL jitter to smooth Redis expiry storms",
      files: ["src/session/ttl.ts"],
    },
    {
      id: "dep-checkout-730",
      serviceId: "checkout-api",
      version: "v7.3.0",
      previousVersion: "v7.2.4",
      startedAt: Date.parse("2026-09-13T22:40:00Z"),
      completedAt: Date.parse("2026-09-13T22:51:00Z"),
      status: "success",
      commit: "e4b70aa",
      author: "Samira Ott",
      message: "Tax engine flag default off",
      files: ["src/tax/engine.ts", "src/flags.ts"],
    },
  ];
}

export function buildLogs(now: number, flags: SimFlags): LogEvent[] {
  const rows: LogEvent[] = [];
  let i = 0;
  const push = (ts: number, serviceId: string, level: LogEvent["level"], message: string) => {
    if (ts > now) return;
    rows.push({ id: `log-${i++}`, ts, serviceId, level, message, traceId: `tr-${(ts / 1000).toFixed(0)}` });
  };

  push(DEPLOY_AT + 5_000, "payments-api", "info", "Deploy v2.8.14 healthy on 12/12 canaries — baking to 100%");
  push(DB_CPU_AT + 12_000, "payments-db", "warn", "cpu 41% and climbing on pg-payments-main after v2.8.14 checkout change");
  push(LATENCY_AT + 8_000, "payments-api", "warn", "authorize p95 310ms and rising — pool wait showing in traces");
  push(INCIDENT_AT + 8_000, "payments-api", "error", "remaining connection slots are reserved for SUPERUSER, too many clients");
  push(INCIDENT_AT + 19_000, "payments-api", "error", "PoolCheckoutTimeout after 5000ms acquiring client from payments-db");
  push(INCIDENT_AT + 27_000, "auth-api", "error", "session persist failed: connection pool exhausted on pg-payments-main");
  push(COMPLAINTS_AT + 6_000, "checkout-api", "warn", "customer support: payment failed retries climbing in EU+US");
  push(INCIDENT_AT + 41_000, "payments-api", "fatal", "worker restart: checkout wait exceeded request budget");
  push(INCIDENT_AT + 58_000, "checkout-api", "warn", "payment authorize 5xx from payments-api — retrying");
  push(INCIDENT_AT + 90_000, "payments-api", "error", "PoolCheckoutTimeout after 5000ms acquiring client from payments-db");
  push(INCIDENT_AT + 2 * 60_000, "auth-api", "error", "login path 500: remaining connection slots are reserved");
  push(INCIDENT_AT + 4 * 60_000, "payments-api", "error", "too many clients already from 10.3.22.14");
  push(INCIDENT_AT + 8 * 60_000, "payments-api", "error", "PoolCheckoutTimeout after 5000ms acquiring client from payments-db");
  push(INCIDENT_AT + 12 * 60_000, "auth-api", "error", "session persist failed: connection pool exhausted on pg-payments-main");
  push(INCIDENT_AT + 18 * 60_000, "payments-api", "fatal", "crash loop backoff on payments-api-7b9c");

  if (flags.mitigateAt) {
    push(flags.mitigateAt + 20_000, "payments-db", "info", "max_connections raised 100 → 180 by commander action");
  }
  if (flags.rollbackAt) {
    push(flags.rollbackAt + 15_000, "payments-api", "info", "Rollback v2.8.14 → v2.8.13 initiated");
    push(flags.rollbackAt + 90_000, "payments-api", "info", "v2.8.13 serving 100% — pool wait p95 falling");
  }
  return rows.filter((l) => l.ts <= now).slice(-40);
}

export function buildIncident(now: number, services: Service[], flags: SimFlags): Incident {
  const investigation = investigate({
    now,
    services,
    metrics: buildMetrics(now, flags),
    deployments: baseDeployments(),
    logs: buildLogs(now, flags),
    affectedServiceIds: ["payments-api", "auth-api"],
    rollbackApplied: Boolean(flags.rollbackAt),
    mitigationApplied: Boolean(flags.mitigateAt),
  });

  const machine = seedMachine("INC-4821");
  const status = machine.state;
  const metrics = buildMetrics(now, flags);
  const logs = buildLogs(now, flags);
  const deployments = baseDeployments();
  const detection = detectIncident({
    incidentId: "INC-4821",
    now,
    metrics,
    logs,
    deployments,
    services,
    rollbackApplied: Boolean(flags.rollbackAt),
  });
  const rca = analyzeRca({
    incidentId: "INC-4821",
    now,
    metrics,
    logs,
    deployments,
    services,
    rollbackApplied: Boolean(flags.rollbackAt),
    mitigationApplied: Boolean(flags.mitigateAt),
  });
  const blast = analyzeBlast({
    incidentId: "INC-4821",
    services,
    failingRequestPct: metrics.at(-1)?.errorRate ?? 27,
    rollbackApplied: Boolean(flags.rollbackAt),
  });
  const remediation = analyzeRemediation({
    incidentId: "INC-4821",
    status,
    rollbackApplied: Boolean(flags.rollbackAt),
    mitigationApplied: Boolean(flags.mitigateAt),
  });

  return finishIncident({
    id: "INC-4821",
    title: "Payments and Auth API failure spike",
    severity: "SEV-1",
    status,
    startedAt: INCIDENT_AT,
    detectedAt: DETECTED_AT,
    affectedServiceIds: ["payments-api", "auth-api"],
    impact: "27% of API requests failing",
    commander: "Maya Chen",
    rollbackApplied: Boolean(flags.rollbackAt),
    mitigationApplied: Boolean(flags.mitigateAt),
    remediationRejected: false,
    machine,
    detection,
    rca,
    blast,
    remediation,
    brief: {
      summary:
        "Payments API v2.8.14 exhausted the shared Postgres pool. Auth is failing as collateral. Highest-confidence fix is an immediate rollback to v2.8.13.",
      impact: "27% of API requests failing",
      users: 18423,
      confidence: 0.91,
      likelyCause: "Deployment v2.8.14",
    },
    investigation,
    timeline: [
      { id: "t1", ts: DEPLOY_AT, kind: "note", title: "Deploy v2.8.14 complete", detail: "Payments API baked to 100% after green canaries.", actor: "spinnaker" },
      { id: "t-db", ts: DB_CPU_AT, kind: "investigate", title: "Database CPU begins increasing", detail: "pg-payments-main CPU and active connections leave baseline. Precursor, not the page.", actor: "investigator" },
      { id: "t-lat", ts: LATENCY_AT, kind: "investigate", title: "API latency increases", detail: "Payments authorize p95 leaves the 178ms baseline. Pool wait is in the traces.", actor: "investigator" },
      { id: "t2", ts: INCIDENT_AT, kind: "detect", title: "HTTP 500 spike", detail: "Failing-request ratio cliffs. Auth follows 20s later as collateral.", actor: "detector" },
      { id: "t-complaints", ts: COMPLAINTS_AT, kind: "coordinate", title: "Customer complaints", detail: "Support volume on payment failed. Comms drafting status.", actor: "comms" },
      { id: "t3", ts: DETECTED_AT, kind: "detect", title: "INC-4821 opened · SEV-1", detail: "Detection agent: actual incident, not a noisy alert. 94% · Payments API · started 10:42. Opening sample http_5xx_rate 12.4% vs 0.3% baseline.", actor: "detector" },
      { id: "t4", ts: INVESTIGATED_AT, kind: "investigate", title: "Causal chain named", detail: "Deploy v2.8.14 → new DB query → pool exhaustion → API timeout → HTTP 500 → payment failures.", actor: "investigator-agent" },
      { id: "t-rca", ts: INVESTIGATED_AT + 12_000, kind: "investigate", title: "RCA engine ranked candidates", detail: "v2.8.14 91% supported. DB overload 78% contributing. Network 12% and external API 6% disconfirmed. Narration bound to the table.", actor: "root-cause" },
      { id: "t-blast", ts: BLAST_AT, kind: "investigate", title: "Blast radius named", detail: "Payments → Checkout → Mobile App → premium users. 18,423 potentially affected. Auth, Profile, Notifications, EU, APAC outside the blast.", actor: "blast-radius" },
      { id: "t-comms", ts: BLAST_AT + 8_000, kind: "coordinate", title: "Audience updates drafted", detail: "Engineers · management · customers. Same incident, different communication. Customers do not hear v2.8.14.", actor: "communication" },
      { id: "t-remediate", ts: REMEDIATION_PENDING_AT, kind: "respond", title: "Remediation playbook ready", detail: "AI: Rollback v2.8.14 · Risk: MEDIUM · Policy: human approval required. Agent will not execute.", actor: "remediation" },
      { id: "t5", ts: INVESTIGATED_AT + 40_000, kind: "coordinate", title: "Maya Chen attached as commander", detail: "Jordan Blake on comms. Payments on-call acknowledged.", actor: "pagerduty" },
    ],
    actors: [
      { id: "h1", kind: "human", name: "Maya Chen", role: "Incident commander", status: "active" },
      { id: "h2", kind: "human", name: "Jordan Blake", role: "Comms", status: "three-audience updates live" },
      { id: "h3", kind: "human", name: "Priya Nair", role: "Payments author", status: "paged" },
      { id: "a1", kind: "agent", name: "detector", role: "Detect", status: "watching error, latency, pool, crash" },
      { id: "a2", kind: "agent", name: "investigator", role: "Investigate", status: `${(investigation.confidence * 100).toFixed(0)}% on ${investigation.likelyCause}` },
      { id: "a3", kind: "agent", name: "remediator", role: "Respond", status: flags.rollbackAt ? "rollback complete" : "awaiting rollback approval" },
      { id: "s1", kind: "service", name: "Payments API", role: "Patient", status: flags.rollbackAt ? "recovering" : "outage" },
      { id: "s2", kind: "service", name: "Auth API", role: "Collateral", status: flags.rollbackAt ? "recovering" : "degraded" },
      { id: "s3", kind: "service", name: "payments-db", role: "Shared pool", status: flags.rollbackAt ? "headroom restored" : "slots exhausted" },
    ],
    actions: [],
  });
}

export function secondaryIncidents(): Incident[] {
  return [
    {
      id: "INC-4818",
      title: "Checkout p95 elevated after tax-engine flag",
      severity: "SEV-2",
      status: "NEED_HUMAN_INPUT",
      startedAt: Date.parse("2026-09-14T08:14:00Z"),
      detectedAt: Date.parse("2026-09-14T08:16:40Z"),
      affectedServiceIds: ["checkout-api"],
      impact: "Checkout p95 410ms · 4% extra errors on tax-inclusive carts",
      commander: "Samira Ott",
      rollbackApplied: false,
      mitigationApplied: false,
      remediationRejected: false,
      machine: seedMachine("INC-4818"),
      detection: detectIncident({
        incidentId: "INC-4818",
        now: Date.parse("2026-09-14T11:08:00Z"),
        metrics: [],
        logs: [],
        deployments: [],
        services: [],
      }),
      rca: analyzeRca({
        incidentId: "INC-4818",
        now: Date.parse("2026-09-14T11:08:00Z"),
        metrics: [],
        logs: [],
        deployments: [],
        services: [],
      }),
      blast: analyzeBlast({
        incidentId: "INC-4818",
        services: [],
        failingRequestPct: 4,
      }),
      remediation: analyzeRemediation({
        incidentId: "INC-4818",
        status: "NEED_HUMAN_INPUT",
      }),
      brief: {
        summary: "Flag new-tax-engine is still off globally but a 5% experiment leaked to EU carts. Not on the payments path.",
        impact: "Checkout p95 410ms · 4% extra errors on tax-inclusive carts",
        users: 2100,
        confidence: 0.64,
        likelyCause: "new-tax-engine experiment leak",
      },
      investigation: {
        summary: "Flag new-tax-engine is still off globally but a 5% experiment leaked to EU carts. Not on the payments path.",
        hypotheses: [
          { id: "h1", kind: "config", title: "Tax engine experiment leak", confidence: 0.64, rationale: "Only tax-inclusive carts regress." },
        ],
        selectedHypothesisId: "h1",
        correlations: [],
        blastRadius: { users: 2100, services: ["Checkout API"], revenuePath: true, regions: ["eu-west-1"], description: "EU tax-inclusive carts only." },
        evidence: [],
        confidence: 0.64,
        likelyCause: "new-tax-engine experiment leak",
        recommendedAction: "Disable new-tax-engine flag",
        beats: [
          { id: "b1", at: Date.parse("2026-09-14T08:10:00Z"), title: "Flag leak", detail: "new-tax-engine 5% experiment on EU carts.", source: "git" },
          { id: "b2", at: Date.parse("2026-09-14T08:14:00Z"), title: "Checkout p95", detail: "410ms on tax-inclusive carts.", source: "infra" },
        ],
        causalChain: [
          { id: "k1", title: "new-tax-engine leak", detail: "5% experiment reached EU carts while globally off." },
          { id: "k2", title: "Checkout latency", detail: "Tax-inclusive path regresses. Traces still missing." },
        ],
      },
      timeline: [
        { id: "x1", ts: Date.parse("2026-09-14T08:14:00Z"), kind: "detect", title: "Checkout p95 watch fired", detail: "EU tax carts only.", actor: "detector" },
        { id: "x2", ts: Date.parse("2026-09-14T08:16:40Z"), kind: "detect", title: "INC-4818 opened · SEV-2", detail: "Triage assigned checkout-api. Machine entered TRIAGING.", actor: "detector" },
        { id: "x3", ts: Date.parse("2026-09-14T08:32:00Z"), kind: "investigate", title: "Insufficient data", detail: "64% confidence after 15m. Tax-engine traces missing. Machine → NEED_HUMAN_INPUT.", actor: "investigator" },
      ],
      actors: [
        { id: "c1", kind: "human", name: "Samira Ott", role: "Commander", status: "active" },
        { id: "c2", kind: "agent", name: "investigator", role: "Investigate", status: "flag leak 64%" },
      ],
      actions: [],
    },
    {
      id: "INC-4812",
      title: "Redis eviction storm on session-redis",
      severity: "SEV-3",
      status: "POSTMORTEM",
      startedAt: Date.parse("2026-09-13T19:02:00Z"),
      detectedAt: Date.parse("2026-09-13T19:04:00Z"),
      resolvedAt: Date.parse("2026-09-13T19:41:00Z"),
      affectedServiceIds: ["session-redis", "auth-api"],
      impact: "Elevated login latency, no hard errors",
      commander: "Luis Ortega",
      rollbackApplied: false,
      mitigationApplied: true,
      remediationRejected: false,
      machine: seedMachine("INC-4812"),
      detection: detectIncident({
        incidentId: "INC-4812",
        now: Date.parse("2026-09-13T19:44:00Z"),
        metrics: [],
        logs: [],
        deployments: [],
        services: [],
        closed: true,
      }),
      rca: analyzeRca({
        incidentId: "INC-4812",
        now: Date.parse("2026-09-13T19:44:00Z"),
        metrics: [],
        logs: [],
        deployments: [],
        services: [],
      }),
      blast: analyzeBlast({
        incidentId: "INC-4812",
        services: [],
        failingRequestPct: 0,
      }),
      remediation: analyzeRemediation({
        incidentId: "INC-4812",
        status: "POSTMORTEM",
        mitigationApplied: true,
      }),
      brief: {
        summary: "Memory cap too low after key-size change. Scaled Redis and added TTL jitter in v4.1.2.",
        impact: "Elevated login latency, no hard errors",
        users: 800,
        confidence: 0.86,
        likelyCause: "Redis memory cap",
      },
      investigation: {
        summary: "Memory cap too low after key-size change. Scaled Redis and added TTL jitter in v4.1.2.",
        hypotheses: [],
        selectedHypothesisId: "",
        correlations: [],
        blastRadius: { users: 800, services: ["Auth API"], revenuePath: false, regions: ["us-east-1"], description: "Login latency only." },
        evidence: [],
        confidence: 0.86,
        likelyCause: "Redis memory cap",
        recommendedAction: "Resolved",
        beats: [
          { id: "b1", at: Date.parse("2026-09-13T19:02:00Z"), title: "Redis evictions", detail: "session-redis eviction_rate 18/s.", source: "alerts" },
          { id: "b2", at: Date.parse("2026-09-13T19:18:00Z"), title: "Scale Redis", detail: "Memory cap raised. TTL jitter in v4.1.2.", source: "deploy" },
        ],
        causalChain: [
          { id: "k1", title: "Key-size change", detail: "Auth v4.1.2 wrote larger session blobs." },
          { id: "k2", title: "Memory cap", detail: "Redis evicted; login latency only." },
        ],
      },
      timeline: [],
      actors: [],
      actions: [],
    },
  ].map((incident) => finishIncident(incident as Omit<Incident, "humanLoop" | "comms" | "postmortem" | "memory">));
}

export function createWorld(now = VIEWER_START, flags: SimFlags = {}): WorldState {
  const metrics = buildMetrics(now, flags);
  const services = applyServiceHealth(baseServices(), metrics, flags);
  const primary = buildIncident(now, services, flags);
  const fleet = computeFleet(metrics, now);
  fleet.failingRequestPct = metrics[metrics.length - 1].errorRate;
  fleet.affectedUsers = primary.investigation.blastRadius.users;

  return {
    now,
    region: "us-east-1",
    onCall: { primary: "Maya Chen", comms: "Jordan Blake" },
    services,
    metrics,
    deployments: baseDeployments(),
    logs: buildLogs(now, flags),
    incidents: [primary, ...secondaryIncidents()],
    fleet,
    alerts: primary.timeline.filter((e) => e.kind === "detect" || e.kind === "investigate"),
    pipeline: null,
    evals: null,
    autonomy: null,
    stack: null,
  };
}
