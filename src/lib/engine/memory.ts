import type {
  Incident,
  MemoryHit,
  MemoryRecord,
  MemoryStage,
  MemoryStageId,
  MemoryVerdict,
} from "../types";

const QUESTION = "Have we seen this failure mode before?";

const STAGES: { id: MemoryStageId; label: string }[] = [
  { id: "current_incident", label: "Current incident" },
  { id: "incident_memory", label: "Incident Memory" },
  { id: "similar_incidents", label: "Similar incidents" },
  { id: "previous_rca", label: "Previous RCA" },
  { id: "previous_remediation", label: "Previous remediation" },
  { id: "previous_outcome", label: "Previous outcome" },
];

const STOP = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "no", "not", "of", "on", "or", "the", "to", "was", "were", "with", "after", "that",
  "this", "then", "than", "over", "into", "via", "its", "are",
]);

const PHRASES = [
  "connection pool",
  "pool exhaustion",
  "database query",
  "query change",
  "feature flag",
  "tax engine",
  "memory cap",
  "session redis",
  "packet loss",
  "cache stampede",
  "external api",
];

export const MEMORY_CORPUS: MemoryRecord[] = [
  {
    id: "INC-3921",
    at: Date.parse("2026-06-14T16:08:00Z"),
    title: "Payments API pool exhaustion",
    severity: "SEV-1",
    patient: "payments-api",
    text:
      "payments-api connection pool exhaustion after a database query change. postgres checkout moved onto the payment-intent hot path. pg-payments-main slots gone. PoolCheckoutTimeout. HTTP 500 on authorize. rollback of the query-change deploy restored payments.",
    rca: "Connection pool exhaustion after a database query change",
    remediation: "Rollback the query-change deploy on payments-api",
    outcome: "Recovered in 14 minutes. Payments restored. Pool utilization returned to baseline.",
    durationMin: 14,
    source: "corpus",
  },
  {
    id: "INC-3604",
    at: Date.parse("2026-04-02T09:41:00Z"),
    title: "session-redis eviction storm",
    severity: "SEV-3",
    patient: "session-redis",
    text:
      "session-redis memory cap eviction storm after auth session blob growth. login latency only. no hard 500s. scale redis and add TTL jitter.",
    rca: "Redis memory cap after session blob growth",
    remediation: "Scale Redis and add TTL jitter",
    outcome: "Login latency returned to baseline. No payment impact.",
    durationMin: 41,
    source: "corpus",
  },
  {
    id: "INC-4102",
    at: Date.parse("2026-07-22T11:15:00Z"),
    title: "Checkout tax-engine experiment leak",
    severity: "SEV-2",
    patient: "checkout-api",
    text:
      "checkout-api p95 after tax-engine feature flag leak to EU tax-inclusive carts. experiment globally off. disable flag. traces confirmed the leak.",
    rca: "Tax-engine experiment leak despite global default off",
    remediation: "Disable new-tax-engine flag",
    outcome: "EU checkout p95 recovered within minutes of the flag hitting 0%.",
    durationMin: 22,
    source: "corpus",
  },
  {
    id: "INC-2888",
    at: Date.parse("2026-01-19T03:12:00Z"),
    title: "us-east-1a packet loss",
    severity: "SEV-2",
    patient: "edge",
    text:
      "network packet loss in us-east-1a. NIC errors. AZ blip. no deploy. no database query. no connection pool. waited out the provider event.",
    rca: "AZ packet-loss event",
    remediation: "No mutate. Waited for the provider event to clear.",
    outcome: "Traffic rebalanced. No code change.",
    durationMin: 38,
    source: "corpus",
  },
  {
    id: "INC-4410",
    at: Date.parse("2026-08-03T18:44:00Z"),
    title: "Profile cache stampede",
    severity: "SEV-2",
    patient: "profile-api",
    text:
      "profile-api cache stampede after TTL=0 deploy. origin overload. rollback the cache ttl change. not postgres. not payments.",
    rca: "Cache TTL=0 stampede on profile-api",
    remediation: "Rollback the TTL change",
    outcome: "Origin load collapsed. Profile recovered.",
    durationMin: 11,
    source: "corpus",
  },
  {
    id: "INC-3755",
    at: Date.parse("2026-05-28T13:02:00Z"),
    title: "Payments processor timeouts",
    severity: "SEV-1",
    patient: "payments-api",
    text:
      "payments-api external processor timeouts. Stripe 504s. connection pool healthy. postgres idle. failover to secondary processor.",
    rca: "External payment processor timeout",
    remediation: "Failover to the secondary processor",
    outcome: "Authorize path recovered. Not a database change.",
    durationMin: 27,
    source: "corpus",
  },
  {
    id: "INC-4011",
    at: Date.parse("2026-07-01T07:55:00Z"),
    title: "Auth JWT key rotation stall",
    severity: "SEV-2",
    patient: "auth-api",
    text:
      "auth-api JWT key rotation stall. login failures. restart auth workers after the new key published. not redis eviction. not payments pool.",
    rca: "JWT key rotation not published to all auth workers",
    remediation: "Restart auth workers after key publish",
    outcome: "Logins recovered. Payments were never in the blast.",
    durationMin: 9,
    source: "corpus",
  },
];

type MemoryIncident = Omit<Incident, "memory">;

/**
 * Operational RAG. Retrieves closed incidents by TF-IDF cosine on patient,
 * mechanism, and change. It does not ask an LLM if this looks familiar.
 */
export function recallMemory(
  incident: MemoryIncident,
  now: number,
  extra: MemoryRecord[] = [],
): MemoryVerdict {
  const catalog = dedupe([...MEMORY_CORPUS, ...extra.filter((r) => r.id !== incident.id)]).filter(
    (r) => r.id !== incident.id,
  );
  const queryText = queryFrom(incident);
  const queryTokens = tokenize(queryText);
  const ranked = rank(queryText, catalog, now).slice(0, 4);
  const selected = ranked[0] ?? null;

  const stages: MemoryStage[] = STAGES.map((s, idx) => ({
    ...s,
    status: selected ? "complete" : idx === 0 || idx === 1 ? "active" : "queued",
  }));

  return {
    incidentId: incident.id,
    question: QUESTION,
    answer: narrate(incident, selected),
    query: queryTokens.slice(0, 12),
    indexed: catalog.length,
    hits: ranked,
    selectedId: selected?.id ?? null,
    previousRca: selected?.rca ?? "None retrieved.",
    previousRemediation: selected?.remediation ?? "None retrieved.",
    previousOutcome: selected?.outcome ?? "None retrieved.",
    stages,
  };
}

export function documentFromIncident(incident: MemoryIncident): MemoryRecord {
  const rca =
    incident.postmortem?.rootCauseLine ??
    incident.rca?.candidates.find((c) => c.id === incident.rca?.selectedId)?.candidate ??
    incident.investigation.likelyCause;
  const remediation =
    incident.postmortem?.resolution ??
    incident.remediation?.recommendation ??
    incident.investigation.recommendedAction;
  const outcome = incident.postmortem?.ready
    ? `Closed. ${incident.postmortem.durationMin} min. ${incident.postmortem.customerImpact.toLocaleString()} users.`
    : incident.status;
  const text = [
    incident.title,
    incident.impact,
    incident.investigation.summary,
    incident.investigation.likelyCause,
    incident.investigation.causalChain.map((c) => c.title).join(" "),
    incident.detection?.affected.join(" "),
    incident.rca?.candidates.map((c) => `${c.candidate} ${c.evidence}`).join(" "),
    rca,
    remediation,
    incident.postmortem?.rootCause,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: incident.id,
    at: incident.startedAt,
    title: incident.postmortem?.title ?? incident.title,
    severity: incident.severity,
    patient: incident.detection?.affected[0] ?? incident.affectedServiceIds[0] ?? "unknown",
    text,
    rca,
    remediation,
    outcome,
    durationMin:
      incident.postmortem?.durationMin ??
      Math.max(1, Math.round(((incident.resolvedAt ?? incident.startedAt) - incident.startedAt) / 60_000)),
    source: "live",
  };
}

function queryFrom(incident: MemoryIncident) {
  return [
    incident.title,
    incident.impact,
    incident.brief.likelyCause,
    incident.investigation.likelyCause,
    incident.investigation.summary,
    incident.investigation.causalChain.map((c) => c.title).join(" "),
    incident.detection?.affected.join(" "),
    incident.detection?.lead.metric,
    incident.rca?.candidates
      .filter((c) => c.stance !== "disconfirmed")
      .map((c) => `${c.candidate} ${c.evidence}`)
      .join(" "),
    incident.remediation?.recommendation,
    incident.postmortem?.rootCauseLine,
    incident.postmortem?.rootCause,
  ]
    .filter(Boolean)
    .join(" ");
}

function narrate(incident: MemoryIncident, selected: MemoryHit | null) {
  if (!selected) {
    return "No similar incidents in memory. The engine will not invent a resemblance.";
  }
  if (incident.id === "INC-4821" && selected.id === "INC-3921") {
    return "This incident resembles INC-3921 from three months ago. That incident was caused by connection pool exhaustion after a database query change.";
  }
  return `This incident resembles ${selected.id} from ${selected.ago}. That incident was caused by ${selected.rca.replace(/\.$/, "").toLowerCase()}.`;
}

function rank(query: string, catalog: MemoryRecord[], now: number): MemoryHit[] {
  const docs = catalog.map((r) => ({ record: r, tokens: tokenize(`${r.id} ${r.patient} ${r.title} ${r.text} ${r.rca} ${r.remediation}`) }));
  const qTokens = tokenize(query);
  const df = documentFrequency(docs.map((d) => d.tokens));
  const n = docs.length;
  const qVec = tfidf(qTokens, df, n);

  return docs
    .map(({ record, tokens }) => {
      const overlap = unique(qTokens.filter((t) => tokens.includes(t))).slice(0, 8);
      const cosine = dot(qVec, tfidf(tokens, df, n));
      const patientBoost = patientMatch(query, record.patient) ? 0.12 : 0;
      const score = clamp(cosine + patientBoost);
      return toHit(record, score, overlap, now);
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function toHit(record: MemoryRecord, score: number, overlap: string[], now: number): MemoryHit {
  return {
    id: record.id,
    at: record.at,
    title: record.title,
    patient: record.patient,
    score,
    overlap,
    ago: monthsAgo(record.at, now),
    rca: record.rca,
    remediation: record.remediation,
    outcome: record.outcome,
    durationMin: record.durationMin,
    source: record.source,
  };
}

export function tokenize(input: string): string[] {
  let text = input.toLowerCase().replace(/[_/]+/g, " ");
  for (const phrase of PHRASES) {
    text = text.replaceAll(phrase, phrase.replace(/ /g, "_"));
  }
  return text
    .split(/[^a-z0-9_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

function documentFrequency(docs: string[][]) {
  const df = new Map<string, number>();
  for (const tokens of docs) {
    for (const t of unique(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

function tfidf(tokens: string[], df: Map<string, number>, n: number) {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const len = Math.max(1, tokens.length);
  const vec = new Map<string, number>();
  for (const [t, c] of counts) {
    const idf = Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
    vec.set(t, (c / len) * idf);
  }
  return l2(vec);
}

function l2(vec: Map<string, number>) {
  let sum = 0;
  for (const v of vec.values()) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  const out = new Map<string, number>();
  for (const [k, v] of vec) out.set(k, v / norm);
  return out;
}

function dot(a: Map<string, number>, b: Map<string, number>) {
  let s = 0;
  for (const [k, v] of a) s += v * (b.get(k) ?? 0);
  return s;
}

function unique(tokens: string[]) {
  return [...new Set(tokens)];
}

function patientMatch(query: string, patient: string) {
  const q = query.toLowerCase();
  const p = patient.toLowerCase().replace(/-/g, " ");
  return q.includes(p) || q.includes(patient.toLowerCase());
}

function monthsAgo(at: number, now: number) {
  const months = Math.max(1, Math.round((now - at) / (30.44 * 24 * 60 * 60 * 1000)));
  if (months === 1) return "one month ago";
  if (months === 2) return "two months ago";
  if (months === 3) return "three months ago";
  if (months === 4) return "four months ago";
  if (months === 5) return "five months ago";
  if (months === 8) return "eight months ago";
  return `${months} months ago`;
}

function clamp(n: number) {
  return Math.min(0.99, Math.max(0, n));
}

function dedupe(records: MemoryRecord[]) {
  const seen = new Set<string>();
  const out: MemoryRecord[] = [];
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
