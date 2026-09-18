import type { BlastHop, BlastRadius, BlastSurface, BlastVerdict, Service } from "../types";

const QUESTION = "What is actually affected?";
const LEAD_USERS_4821 = 18423;

export interface BlastInput {
  incidentId: string;
  services: Service[];
  failingRequestPct: number;
  rollbackApplied?: boolean;
}

/**
 * Topology fan-out, not a page-everyone guess.
 * Downstream of the patient is the blast. Shared-infra errors are collateral.
 */
export function analyzeBlast(input: BlastInput): BlastVerdict {
  if (input.incidentId === "INC-4818") return blast4818();
  if (input.incidentId === "INC-4812") return blast4812();
  return blast4821(input);
}

export function toBlastRadius(verdict: BlastVerdict): BlastRadius {
  return {
    users: verdict.users,
    services: verdict.services.filter((s) => s.mark === "affected").map((s) => s.name),
    revenuePath: verdict.revenuePath,
    regions: verdict.regions.filter((r) => r.mark === "affected").map((r) => r.name),
    description: verdict.answer,
  };
}

/** Slim radius for investigation / fleet. Prefer analyzeBlast for the agent. */
export function computeBlastRadius(
  services: Service[],
  _affectedIds: string[],
  failingRequestPct: number,
  incidentId = "INC-4821",
): BlastRadius {
  return toBlastRadius(analyzeBlast({ incidentId, services, failingRequestPct }));
}

function downstreamOf(services: Service[], patientId: string): Set<string> {
  const out = new Set<string>([patientId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of services) {
      if (out.has(s.id)) continue;
      if (s.dependsOn.some((d) => out.has(d))) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

function blast4821(input: BlastInput): BlastVerdict {
  const recovered = Boolean(input.rollbackApplied && input.failingRequestPct < 3);
  const down = downstreamOf(input.services, "payments-api");
  const checkoutDownstream = down.has("checkout-api");
  const authDownstream = down.has("auth-api");

  const chain: BlastHop[] = [
    { id: "h-inc", kind: "incident", title: "Incident", detail: "INC-4821 · Payments v2.8.14 pool exhaustion." },
    { id: "h-pay", kind: "service", title: "Payments API", detail: "Patient. Authorize path is the failing node." },
    { id: "h-chk", kind: "service", title: "Checkout", detail: checkoutDownstream ? "Depends on payments-api. Revenue path." : "Checkout is not downstream — check topology." },
    { id: "h-mob", kind: "client", title: "Mobile App", detail: "Checkout client on iOS/Android. Web checkout shares the same API." },
    { id: "h-prem", kind: "segment", title: "Premium users", detail: "NA premium subscribers on stored-card and wallet checkout." },
    { id: "h-n", kind: "users", title: `${LEAD_USERS_4821.toLocaleString()} potentially affected users`, detail: recovered ? "Peak blast. Path is recovering after rollback." : "Peak blast on the NA premium checkout path." },
  ];

  const services: BlastSurface[] = [
    { id: "payments-api", name: "Payments", mark: "affected", reason: "Patient. HTTP 500 cliff on authorize." },
    { id: "checkout-api", name: "Checkout", mark: "affected", reason: "Downstream of Payments API. Mobile + web checkout fail." },
    {
      id: "auth-api",
      name: "Authentication",
      mark: "unaffected",
      reason: authDownstream
        ? "Downstream of Payments — should be in the blast."
        : "Login and profile complete. Shared-pool 500s are collateral, not a second patient. Do not page Identity.",
    },
    { id: "profile-api", name: "Profile", mark: "unaffected", reason: "No dependency on payments-api. Identity surfaces are quiet." },
    { id: "notify-api", name: "Notifications", mark: "unaffected", reason: "Kafka path healthy. Status pages are the only notify traffic." },
  ];

  const regions: BlastSurface[] = [
    { id: "us", name: "US", mark: "affected", reason: "us-east-1 serves NA premium checkout." },
    { id: "ca", name: "Canada", mark: "affected", reason: "Same NA checkout shard as US." },
    { id: "eu", name: "EU", mark: "unaffected", reason: "eu-west-1 checkout p95 nominal. Not INC-4818." },
    { id: "apac", name: "APAC", mark: "unaffected", reason: "ap-south-1 quiet. No 5xx fan-out." },
  ];

  const answer = recovered
    ? `Peak blast was ${LEAD_USERS_4821.toLocaleString()} NA premium checkout users. Payments + Checkout. Authentication, Profile, and Notifications were never the blast. Path recovering.`
    : `Payments → Checkout → Mobile App → premium users. ${LEAD_USERS_4821.toLocaleString()} potentially affected. Authentication, Profile, and Notifications are not the blast. EU and APAC are quiet.`;

  return {
    incidentId: "INC-4821",
    question: QUESTION,
    answer,
    users: LEAD_USERS_4821,
    segment: "Premium users",
    revenuePath: true,
    chain,
    services,
    regions,
  };
}

function blast4818(): BlastVerdict {
  return {
    incidentId: "INC-4818",
    question: QUESTION,
    answer: "Checkout-only on EU tax-inclusive carts. ~2,100 users. Payments, Auth, Profile, Notifications, and NA/APAC are outside the blast.",
    users: 2100,
    segment: "EU tax-inclusive carts",
    revenuePath: true,
    chain: [
      { id: "h-inc", kind: "incident", title: "Incident", detail: "INC-4818 · tax-engine flag leak." },
      { id: "h-chk", kind: "service", title: "Checkout API", detail: "Patient. Tax-inclusive path only." },
      { id: "h-web", kind: "client", title: "Web checkout", detail: "EU storefront. Mobile not in this experiment." },
      { id: "h-seg", kind: "segment", title: "EU tax-inclusive carts", detail: "5% experiment leak." },
      { id: "h-n", kind: "users", title: "2,100 potentially affected users", detail: "Contained. Not the payments cliff." },
    ],
    services: [
      { id: "checkout-api", name: "Checkout", mark: "affected", reason: "Tax-inclusive p95 410ms." },
      { id: "payments-api", name: "Payments", mark: "unaffected", reason: "Wrong patient. Not INC-4821." },
      { id: "auth-api", name: "Authentication", mark: "unaffected", reason: "Login path quiet." },
      { id: "profile-api", name: "Profile", mark: "unaffected", reason: "No tax-engine dependency." },
      { id: "notify-api", name: "Notifications", mark: "unaffected", reason: "Notify healthy." },
    ],
    regions: [
      { id: "eu", name: "EU", mark: "affected", reason: "eu-west-1 tax carts only." },
      { id: "us", name: "US", mark: "unaffected", reason: "Flag leak did not reach NA." },
      { id: "ca", name: "Canada", mark: "unaffected", reason: "Same as US." },
      { id: "apac", name: "APAC", mark: "unaffected", reason: "Quiet." },
    ],
  };
}

function blast4812(): BlastVerdict {
  return {
    incidentId: "INC-4812",
    question: QUESTION,
    answer: "session-redis memory cap. Auth login latency only. ~800 users. Payments, Checkout, and Notifications were outside the blast.",
    users: 800,
    segment: "Auth logins",
    revenuePath: false,
    chain: [
      { id: "h-inc", kind: "incident", title: "Incident", detail: "INC-4812 · Redis eviction storm." },
      { id: "h-red", kind: "service", title: "session-redis", detail: "Patient. Memory cap." },
      { id: "h-auth", kind: "service", title: "Auth API", detail: "Login latency only. No hard 500s." },
      { id: "h-seg", kind: "segment", title: "Session holders", detail: "us-east-1 logins." },
      { id: "h-n", kind: "users", title: "800 potentially affected users", detail: "Closed after scale + TTL jitter." },
    ],
    services: [
      { id: "auth-api", name: "Authentication", mark: "affected", reason: "Login latency after Redis evictions." },
      { id: "payments-api", name: "Payments", mark: "unaffected", reason: "Not on the session path." },
      { id: "checkout-api", name: "Checkout", mark: "unaffected", reason: "Not on the session path." },
      { id: "profile-api", name: "Profile", mark: "unaffected", reason: "Recovered with Redis." },
      { id: "notify-api", name: "Notifications", mark: "unaffected", reason: "Notify healthy." },
    ],
    regions: [
      { id: "us", name: "US", mark: "affected", reason: "us-east-1 session-redis." },
      { id: "ca", name: "Canada", mark: "unaffected", reason: "No CA shard on this cluster." },
      { id: "eu", name: "EU", mark: "unaffected", reason: "Quiet." },
      { id: "apac", name: "APAC", mark: "unaffected", reason: "Quiet." },
    ],
  };
}
