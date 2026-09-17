import { formatTime } from "@/lib/format";
import type { DetectionVerdict } from "@/lib/types";
import { ConfidenceBar, SevBadge } from "./chrome";

export function DetectionBoard({
  detection,
  compact = false,
}: {
  detection: DetectionVerdict;
  compact?: boolean;
}) {
  const firing = detection.signals.filter((s) => s.firing).length;
  const incident = detection.verdict === "incident";

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Detection agent · {detection.incidentId}</span>
        <span className={`kicker ${incident ? "text-sev1" : "text-muted"}`}>
          {incident ? "actual incident" : "noisy alert"} · {firing}/7 families
        </span>
      </div>

      <p className="text-[13px]">
        {detection.question}{" "}
        <span className="text-muted">{detection.answer}</span>
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)]">
        <pre className="overflow-x-auto border border-line bg-panel p-3 font-mono text-[11px] leading-5 text-ink">
{`{
  "service": "${detection.lead.service}",
  "metric": "${detection.lead.metric}",
  "current": "${detection.lead.current}",
  "baseline": "${detection.lead.baseline}",
  "increase": "${detection.lead.increase}"
}`}
        </pre>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border border-line bg-panel p-3 text-[12px]">
          <div>
            <div className="kicker mb-1">Severity</div>
            <SevBadge severity={detection.severity} />
          </div>
          <div>
            <div className="kicker mb-1">Confidence</div>
            <ConfidenceBar value={detection.confidence} />
          </div>
          <div>
            <div className="kicker mb-0.5">Potentially affected</div>
            <div>{detection.affected.join(", ")}</div>
          </div>
          <div>
            <div className="kicker mb-0.5">Started</div>
            <div className="mono">{formatTime(detection.startedAt)}</div>
          </div>
        </dl>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-7">
        {detection.signals.map((s) => (
          <div key={s.source} className="border border-line px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="kicker">{s.label}</span>
              <span className={`mono text-[10px] uppercase ${s.firing ? "text-sev1" : "text-faint"}`}>
                {s.firing ? "firing" : "quiet"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted">{s.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
