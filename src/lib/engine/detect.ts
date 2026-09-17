import { DETECTED_AT, INCIDENT_AT } from "../clock";
import type { FleetSnapshot, Incident, MetricSample, Service } from "../types";

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

export function detectOpenIncident(
  metrics: MetricSample[],
  existing: Incident[],
): { shouldOpen: boolean; startedAt: number; detectedAt: number } {
  if (existing.some((i) => i.id === "INC-4821" && i.status !== "resolved")) {
    return { shouldOpen: false, startedAt: INCIDENT_AT, detectedAt: DETECTED_AT };
  }
  const last = latestMetrics(metrics);
  return {
    shouldOpen: last.errorRate > 8,
    startedAt: INCIDENT_AT,
    detectedAt: DETECTED_AT,
  };
}
