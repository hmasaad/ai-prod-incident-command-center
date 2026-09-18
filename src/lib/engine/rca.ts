import { DB_CPU_AT, DEPLOY_AT, INCIDENT_AT } from "../clock";
import type {
  Deployment,
  LogEvent,
  MetricSample,
  RcaCandidate,
  RcaEvidenceItem,
  RcaVerdict,
  RcaVeto,
  Service,
} from "../types";
import { baselineMetrics, latestMetrics } from "./detect";

function clamp(n: number, min = 0, max = 0.99) {
  return Math.min(max, Math.max(min, n));
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

const QUESTION = "Which candidate does the evidence support — and which does it rule out?";

export interface RcaInput {
  incidentId: string;
  now: number;
  metrics: MetricSample[];
  logs: LogEvent[];
  deployments: Deployment[];
  services: Service[];
  rollbackApplied?: boolean;
  mitigationApplied?: boolean;
  humanEvidence?: boolean;
}

/**
 * Deterministic RCA engine. Scores candidates from an evidence pack.
 * A constrained narrator may only interpolate the scored rows — it cannot
 * invent a cause the engine did not emit.
 */
export function analyzeRca(input: RcaInput): RcaVerdict {
  if (input.incidentId === "INC-4818") return rca4818(input);
  if (input.incidentId === "INC-4812") return rca4812();
  if (input.incidentId === "INC-4821") return rca4821(input);
  return rcaUnknown(input.incidentId);
}

/** Peak samples in the incident window so recovery does not rewrite the cause ranking. */
function peakInWindow(metrics: MetricSample[]) {
  const window = metrics.filter((m) => m.ts >= DEPLOY_AT && m.ts <= INCIDENT_AT + 20 * 60_000);
  const src = window.length ? window : metrics;
  const max = (fn: (m: MetricSample) => number) => Math.max(...src.map(fn));
  return {
    errorRate: max((m) => m.errorRate),
    latencyP95: max((m) => m.latencyP95),
    dbConnections: max((m) => m.dbConnections),
    dbCpu: max((m) => m.dbCpu ?? 22),
    rps: max((m) => m.rps),
  };
}

function rca4821(input: RcaInput): RcaVerdict {
  const last = latestMetrics(input.metrics);
  const base = baselineMetrics(input.metrics, input.now);
  const peak = peakInWindow(input.metrics);
  const deploy = input.deployments.find((d) => d.id === "dep-payments-2814") ?? input.deployments[0];
  const lagMin = Math.round((INCIDENT_AT - (deploy?.completedAt ?? DEPLOY_AT)) / 60_000);
  const dbLagMin = Math.round((DB_CPU_AT - (deploy?.completedAt ?? DEPLOY_AT)) / 60_000);
  const deployLive = deploy?.status === "success" || deploy?.status === "in_progress" || deploy?.status === "rolling_back" || deploy?.status === "rolled_back";
  const gitPool = Boolean(deploy?.files.some((f) => /pool|intent/i.test(f)));
  const poolLogs = input.logs.filter((l) => /pool|timeout|connection|too many clients/i.test(l.message));
  const traceHits = input.logs.filter(
    (l) => l.traceId && /pool wait|PoolCheckoutTimeout|checkout wait/i.test(l.message),
  );
  const packetLogs = input.logs.filter((l) => /packet.?loss|retrans|net_timeout|tcp reset/i.test(l.message));
  const extLogs = input.logs.filter((l) => /stripe|adyen|processor|timeout waiting for upstream/i.test(l.message));
  const kafka = input.services.find((s) => s.id === "kafka-events");
  const kafkaHealthy = !kafka || kafka.health === "healthy";
  const cpuSat = peak.dbCpu >= base.dbCpu * 1.4;
  const connSat = peak.dbConnections >= base.dbConnections * 1.4;
  const rpsQuiet = last.rps < 4200;

  const pack: RcaEvidenceItem[] = [
    {
      family: "deploy",
      label: "Recent deployments",
      present: deployLive,
      fact: deploy
        ? `${deploy.version} on payments-api completed ${lagMin}m before the 10:42 cliff (${deploy.commit}).`
        : "No recent deploy on the patient.",
    },
    {
      family: "logs",
      label: "Logs",
      present: poolLogs.length >= 4,
      fact:
        poolLogs.length >= 4
          ? `${poolLogs.length} pool / timeout / too-many-clients lines on payments-api and auth-api.`
          : "No pool-exhaustion log cluster.",
    },
    {
      family: "metrics",
      label: "Metrics",
      present: cpuSat || connSat,
      fact: `Peak DB CPU ${peak.dbCpu.toFixed(0)}% vs ${base.dbCpu.toFixed(0)}% baseline. Peak connections ${Math.round(peak.dbConnections)} vs ${Math.round(base.dbConnections)}. RPS ${Math.round(last.rps)} (not a surge).`,
    },
    {
      family: "traces",
      label: "Traces",
      present: traceHits.length > 0,
      fact:
        traceHits.length > 0
          ? `${traceHits.length} traces show pool wait / PoolCheckoutTimeout before the worker budget. Latency moved at 10:39, 500s at 10:42.`
          : "No pool-wait spans in the trace window.",
    },
    {
      family: "git",
      label: "Git commits",
      present: gitPool,
      fact: gitPool
        ? `${deploy?.commit ?? "a1f3c2d"} · ${deploy?.message ?? "eager connection checkout"} · ${(deploy?.files ?? []).join(", ")}.`
        : "No pool-related files in the deploy.",
    },
    {
      family: "infra",
      label: "Infrastructure events",
      present: true,
      fact:
        packetLogs.length === 0
          ? "No packet-loss spike, no AZ event, no NIC error. Network family is quiet."
          : `${packetLogs.length} packet-loss lines — network stays in the table.`,
    },
  ];

  const deployProb = clamp(
    (deployLive ? 0.55 : 0.1) +
      (lagMin >= 1 && lagMin <= 20 ? 0.16 : 0) +
      (gitPool ? 0.1 : 0) +
      (poolLogs.length >= 4 ? 0.07 : 0) +
      (traceHits.length > 0 ? 0.03 : 0),
  );

  const dbProb = clamp((cpuSat ? 0.42 : 0.12) + (connSat ? 0.36 : 0.08), 0, 0.78);

  const networkProb = packetLogs.length > 0 ? 0.52 : 0.12;
  const externalProb = clamp(0.06 + (extLogs.length > 0 ? 0.35 : 0) + (kafkaHealthy ? 0 : 0.2), 0, 0.4);

  const candidates: RcaCandidate[] = [
    {
      id: "c-deploy",
      candidate: "v2.8.14 deployment",
      probability: deployProb,
      evidence:
        lagMin === 4
          ? "Started 4 min before incident"
          : `Completed ${lagMin}m before incident; ${dbLagMin}m before DB CPU`,
      stance: "supported",
      supportingFamilies: ["deploy", "git", "logs", "traces"],
    },
    {
      id: "c-db",
      candidate: "DB overload",
      probability: dbProb,
      evidence: "CPU + connection saturation",
      stance: "contributing",
      supportingFamilies: ["metrics", "logs", "traces"],
    },
    {
      id: "c-net",
      candidate: "Network issue",
      probability: networkProb,
      evidence: packetLogs.length ? "Packet-loss lines in the window" : "No packet-loss spike",
      stance: packetLogs.length ? "contributing" : "disconfirmed",
      supportingFamilies: ["infra"],
    },
    {
      id: "c-ext",
      candidate: "External API",
      probability: externalProb,
      evidence: kafkaHealthy && extLogs.length === 0 ? "Dependency healthy" : "Upstream errors in the window",
      stance: kafkaHealthy && extLogs.length === 0 ? "disconfirmed" : "contributing",
      supportingFamilies: ["infra", "metrics"],
    },
  ];
  candidates.sort((a, b) => b.probability - a.probability);

  const selected = candidates.find((c) => c.stance === "supported") ?? candidates[0];

  const vetoed: RcaVeto[] = [
    {
      claim: "AWS region / AZ outage",
      reason: "Infrastructure family is quiet. Cloud health did not fire. Engine will not promote it.",
    },
    {
      claim: "Organic traffic surge / DDoS",
      reason: rpsQuiet
        ? "RPS is within the morning band. Metrics do not support a traffic cause."
        : "RPS is elevated but still does not explain the ordered pool-exhaustion traces.",
    },
    {
      claim: "Auth API is the actor",
      reason: "Auth 500s lag payments by ~20s on the shared pool. Collateral, not a candidate the engine selected.",
    },
  ];

  const recovered = Boolean(input.rollbackApplied && last.errorRate < 3);
  const answer = recovered
    ? "Cause ranking holds after rollback: v2.8.14 remains the supported candidate. Recovery is confirmation, not a new cause."
    : selected.probability >= 0.75
      ? "Evidence pack supports v2.8.14 as the cause. DB overload is the mechanism, not a rival. Network and external API are disconfirmed."
      : "Evidence pack is incomplete. Engine will not name a root cause below the 75% gate.";

  return bindVerdict({
    incidentId: "INC-4821",
    question: QUESTION,
    answer,
    selectedId: selected.id,
    confidence: selected.probability,
    candidates,
    evidencePack: pack,
    vetoed,
    bound: true,
  });
}

function rca4818(input: RcaInput): RcaVerdict {
  const tracesPresent = Boolean(input.humanEvidence);
  const pack: RcaEvidenceItem[] = [
    { family: "deploy", label: "Recent deployments", present: false, fact: "No checkout deploy in the detect window. v7.3.0 is 9h old with the flag default off." },
    { family: "logs", label: "Logs", present: false, fact: "Checkout latency warnings only. No 500 cluster." },
    { family: "metrics", label: "Metrics", present: true, fact: "Checkout p95 410ms vs 190ms. Isolated to tax-inclusive carts." },
    {
      family: "traces",
      label: "Traces",
      present: tracesPresent,
      fact: tracesPresent
        ? "Human attached tax-engine traces. Leak confirmed on EU tax-inclusive carts."
        : "Tax-engine traces missing. Engine will not promote a cause without this family.",
    },
    { family: "git", label: "Git commits", present: true, fact: "Flag new-tax-engine default off; 5% experiment leak suspected." },
    { family: "infra", label: "Infrastructure events", present: true, fact: "No packet-loss spike. Checkout DB pool nominal." },
  ];
  const flagProb = tracesPresent ? 0.82 : 0.64;
  const candidates: RcaCandidate[] = [
    { id: "c-flag", candidate: "Tax-engine flag leak", probability: flagProb, evidence: tracesPresent ? "Traces confirm EU experiment leak" : "Tax-inclusive carts only; traces missing", stance: "supported", supportingFamilies: tracesPresent ? ["git", "metrics", "traces"] : ["git", "metrics"] },
    { id: "c-ext", candidate: "External tax API", probability: tracesPresent ? 0.09 : 0.18, evidence: tracesPresent ? "Tax API healthy in attached traces" : "Cannot confirm — traces family empty", stance: tracesPresent ? "disconfirmed" : "contributing", supportingFamilies: ["traces"] },
    { id: "c-deploy", candidate: "Checkout v7.3.0", probability: 0.12, evidence: "9h before the watch; flag default off", stance: "disconfirmed", supportingFamilies: ["deploy"] },
    { id: "c-net", candidate: "Network issue", probability: 0.08, evidence: "No packet-loss spike", stance: "disconfirmed", supportingFamilies: ["infra"] },
  ];
  return bindVerdict({
    incidentId: "INC-4818",
    question: QUESTION,
    answer: tracesPresent
      ? "Human traces completed the pack. Engine now supports the tax-engine flag leak at 82%."
      : "Engine will not name a root cause. Top candidate 64% is below the 75% gate. Traces family is empty.",
    selectedId: "c-flag",
    confidence: flagProb,
    candidates,
    evidencePack: pack,
    vetoed: [{ claim: "Payments v2.8.14", reason: "Wrong patient. Checkout-only regression. Engine refuses cross-incident invention." }],
    bound: true,
  });
}

function rca4812(): RcaVerdict {
  const pack: RcaEvidenceItem[] = [
    { family: "deploy", label: "Recent deployments", present: true, fact: "Auth v4.1.2 key-size change preceded the eviction storm." },
    { family: "logs", label: "Logs", present: false, fact: "Auth login latency warnings, no hard 500s." },
    { family: "metrics", label: "Metrics", present: true, fact: "session-redis eviction_rate 18/s vs 0.4/s baseline." },
    { family: "traces", label: "Traces", present: true, fact: "Get/set spans on session-redis; no pool wait on Postgres." },
    { family: "git", label: "Git commits", present: true, fact: "Larger session blobs + TTL jitter in v4.1.2." },
    { family: "infra", label: "Infrastructure events", present: true, fact: "Redis memory cap saturated, then recovered after scale. No packet loss." },
  ];
  const candidates: RcaCandidate[] = [
    { id: "c-redis", candidate: "Redis memory cap", probability: 0.86, evidence: "Eviction storm after key-size change", stance: "supported", supportingFamilies: ["metrics", "infra", "git"] },
    { id: "c-deploy", candidate: "Auth v4.1.2", probability: 0.71, evidence: "Wrote larger session blobs", stance: "contributing", supportingFamilies: ["deploy", "git"] },
    { id: "c-net", candidate: "Network issue", probability: 0.08, evidence: "No packet-loss spike", stance: "disconfirmed", supportingFamilies: ["infra"] },
    { id: "c-ext", candidate: "External API", probability: 0.05, evidence: "Dependency healthy", stance: "disconfirmed", supportingFamilies: ["infra"] },
  ];
  return bindVerdict({
    incidentId: "INC-4812",
    question: QUESTION,
    answer: "Evidence pack supports Redis memory cap. Auth v4.1.2 is the contributing change. Network and external API are disconfirmed.",
    selectedId: "c-redis",
    confidence: 0.86,
    candidates,
    evidencePack: pack,
    vetoed: [{ claim: "Postgres pool exhaustion", reason: "Wrong data plane. Traces stay on session-redis. Engine will not invent INC-4821 causality here." }],
    bound: true,
  });
}

function rcaUnknown(incidentId: string): RcaVerdict {
  const pack: RcaEvidenceItem[] = [
    { family: "deploy", label: "Recent deployments", present: false, fact: "No deploy family bound to this incident." },
    { family: "logs", label: "Logs", present: false, fact: "No log cluster in the pack." },
    { family: "metrics", label: "Metrics", present: false, fact: "No metric family scored for this id." },
    { family: "traces", label: "Traces", present: false, fact: "No traces." },
    { family: "git", label: "Git commits", present: false, fact: "No git evidence." },
    { family: "infra", label: "Infrastructure events", present: false, fact: "No infra family." },
  ];
  return bindVerdict({
    incidentId,
    question: QUESTION,
    answer: "Evidence pack is empty. Engine will not name a root cause. It will not copy INC-4821 causality.",
    selectedId: "c-none",
    confidence: 0.2,
    candidates: [
      { id: "c-none", candidate: "Insufficient evidence", probability: 0.2, evidence: "Empty pack", stance: "disconfirmed", supportingFamilies: [] },
    ],
    evidencePack: pack,
    vetoed: [{ claim: "v2.8.14 deployment", reason: "Wrong incident. Engine will not invent a cause from another patient's pack." }],
    bound: true,
  });
}

function bindVerdict(partial: Omit<RcaVerdict, "narration"> & { narration?: string }): RcaVerdict {
  const narration = narrateFromEngine(partial);
  return { ...partial, narration, bound: true };
}

/**
 * Constrained narrator. Interpolates engine fields only.
 * If a caller tried to inject a cause, constrainNarration strips it.
 */
export function narrateFromEngine(verdict: Omit<RcaVerdict, "narration"> | RcaVerdict): string {
  const top = verdict.candidates.find((c) => c.id === verdict.selectedId) ?? verdict.candidates[0];
  const contributing = verdict.candidates.filter((c) => c.stance === "contributing");
  const out = verdict.candidates.filter((c) => c.stance === "disconfirmed");
  const parts = [
    `Most likely cause is ${top.candidate} (${pct(top.probability)}). Evidence: ${top.evidence}.`,
    contributing.length
      ? `Contributing: ${contributing.map((c) => `${c.candidate} ${pct(c.probability)} (${c.evidence})`).join("; ")}.`
      : "",
    out.length
      ? `Disconfirmed: ${out.map((c) => `${c.candidate} ${pct(c.probability)} — ${c.evidence}`).join("; ")}.`
      : "",
    "Narration is bound to these rows. No other cause is licensed.",
  ];
  return constrainNarration(parts.filter(Boolean).join(" "), verdict.candidates);
}

/** Drop any clause that names a cause the engine did not score. */
export function constrainNarration(text: string, candidates: RcaCandidate[]): string {
  const licensed = candidates.map((c) => c.candidate.toLowerCase());
  return text
    .split(". ")
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      const mentionsCause = /\b(caused by|root cause is|most likely cause is|blame)\b/.test(lower);
      if (!mentionsCause) return true;
      return licensed.some((name) => lower.includes(name));
    })
    .join(". ");
}
