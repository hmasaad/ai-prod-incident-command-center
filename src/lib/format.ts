import type { IncidentStatus, Severity, ServiceHealth } from "./types";

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatClock(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export function formatTime(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function formatPct(n: number, digits = 1) {
  return `${n.toFixed(digits)}%`;
}

export function formatDelta(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n)}%`;
}

export function statusLabel(status: IncidentStatus) {
  return status.replace("_", " ").toUpperCase();
}

export function severityTone(sev: Severity) {
  if (sev === "SEV-1") return "sev1";
  if (sev === "SEV-2") return "sev2";
  if (sev === "SEV-3") return "sev3";
  return "muted";
}

export function healthTone(health: ServiceHealth) {
  if (health === "outage") return "sev1";
  if (health === "degraded") return "sev2";
  return "ok";
}
