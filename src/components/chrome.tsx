import type { IncidentStatus, Severity, ServiceHealth } from "@/lib/types";
import { formatClock } from "@/lib/format";

export function SevBadge({ severity }: { severity: Severity }) {
  const color =
    severity === "SEV-1"
      ? "text-sev1 border-sev1/40 bg-sev1/10"
      : severity === "SEV-2"
        ? "text-sev2 border-sev2/40 bg-sev2/10"
        : severity === "SEV-3"
          ? "text-sev3 border-sev3/40 bg-sev3/10"
          : "text-muted border-line";
  return (
    <span className={`mono border px-1.5 py-0.5 text-[10px] tracking-wide ${color}`}>
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const tone =
    status === "ESCALATED" || status === "DETECTED"
      ? "text-sev1 border-sev1/40 bg-sev1/10"
      : status === "NEED_HUMAN_INPUT" || status === "REMEDIATION_PENDING" || status === "REMEDIATING"
        ? "text-sev2 border-sev2/40 bg-sev2/10"
        : status === "RESOLVED" || status === "POSTMORTEM"
          ? "text-ok border-ok/40 bg-ok/10"
          : "text-info border-info/40 bg-info/10";
  return (
    <span className={`mono border px-1.5 py-0.5 text-[10px] tracking-wide ${tone}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function HealthDot({ health }: { health: ServiceHealth }) {
  const color =
    health === "outage" ? "bg-sev1" : health === "degraded" ? "bg-sev2" : "bg-ok";
  return <span className={`sev-dot ${color}`} />;
}

export function TopBar({
  now,
  region,
  openCount,
  onCall,
}: {
  now: number;
  region: string;
  openCount: number;
  onCall: { primary: string; comms: string };
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg-2 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center border border-line-2 bg-panel text-[11px] font-semibold tracking-tight">
          ICC
        </div>
        <div>
          <div className="text-sm font-medium tracking-tight">Incident Command Center</div>
          <div className="kicker">AI production commander · gateway · orchestrator · agents</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted">
        <span className="mono uppercase">{region}</span>
        <span className="mono">{formatClock(now)}</span>
        <span className="flex items-center gap-1.5 text-ok">
          <span className="live-dot" />
          LIVE
        </span>
        <span className={openCount > 0 ? "text-sev1" : "text-ok"}>
          {openCount} OPEN
        </span>
        <span>
          On-call {onCall.primary} · comms {onCall.comms}
        </span>
      </div>
    </header>
  );
}

export function MetricChart({
  points,
  color = "var(--sev1)",
  markerTs,
  markerLabel,
}: {
  points: { ts: number; value: number }[];
  color?: string;
  markerTs?: number;
  markerLabel?: string;
}) {
  const w = 560;
  const h = 120;
  const pad = { l: 8, r: 8, t: 10, b: 8 };
  if (points.length < 2) return null;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = Math.max(0.001, max - min);
  const x = (ts: number) => {
    const t0 = points[0].ts;
    const t1 = points[points.length - 1].ts;
    return pad.l + ((ts - t0) / Math.max(1, t1 - t0)) * (w - pad.l - pad.r);
  };
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (h - pad.t - pad.b);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${d} L${x(points[points.length - 1].ts).toFixed(1)} ${h - pad.b} L${x(points[0].ts).toFixed(1)} ${h - pad.b} Z`;
  const markerX = markerTs ? x(markerTs) : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[120px] w-full" role="img">
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
      {markerX !== null && (
        <>
          <line
            x1={markerX}
            x2={markerX}
            y1={pad.t}
            y2={h - pad.b}
            stroke="var(--muted)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          {markerLabel && (
            <text x={markerX + 4} y={14} fill="var(--muted)" fontSize="9" fontFamily="var(--font-geist-mono)">
              {markerLabel}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 bg-panel-2">
        <div className="h-1.5 bg-info" style={{ width: `${pct}%` }} />
      </div>
      <span className="mono text-[11px] text-ink">{pct}%</span>
    </div>
  );
}
