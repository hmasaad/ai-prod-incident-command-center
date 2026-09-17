import type { BlastRadius, Service } from "../types";

const USERS_PER_RPS = 11.5;

export function computeBlastRadius(
  services: Service[],
  affectedIds: string[],
  failingRequestPct: number,
): BlastRadius {
  const affected = services.filter((s) => affectedIds.includes(s.id));
  const rps = affected.reduce((sum, s) => sum + s.rps, 0);
  const users = Math.round(rps * USERS_PER_RPS * Math.min(1.05, Math.max(0.04, failingRequestPct / 27)));
  const revenuePath = affectedIds.some((id) =>
    ["payments-api", "checkout-api", "auth-api"].includes(id),
  );

  return {
    users,
    services: affected.map((s) => s.name),
    revenuePath,
    regions: ["us-east-1"],
    description: revenuePath
      ? `Checkout and authentication sit on the payment path. At ${Math.round(rps)} combined RPS, roughly ${users.toLocaleString()} users are in the blast radius.`
      : `Impact is contained to ${affected.map((s) => s.name).join(", ")}.`,
  };
}
