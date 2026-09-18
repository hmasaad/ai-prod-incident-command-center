import { riskTone } from "@/lib/engine/remediate";
import { formatNumber, formatTime } from "@/lib/format";
import type { HumanLoopBrief } from "@/lib/types";

export function HumanLoopBoard({
  brief,
  busy = false,
  onApprove,
  onReject,
}: {
  brief: HumanLoopBrief;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <section className="border-b border-line">
      <div className="flex items-center gap-3 border-b border-line bg-sev1/10 px-4 py-3">
        <span className="mono border border-sev1 bg-sev1 px-2 py-1 text-[11px] font-medium tracking-wide text-bg">
          {brief.severity}
        </span>
        <h1 className="text-lg font-medium tracking-tight">{brief.title}</h1>
        <span className="ml-auto kicker">{brief.incidentId} · human in the loop</span>
      </div>

      <dl className="grid grid-cols-2 gap-0 border-b border-line sm:grid-cols-4">
        <HitlStat label="Impact" value={`${formatNumber(brief.users)} users`} />
        <HitlStat label="Error Rate" value={brief.errorRate} hot />
        <HitlStat label="Latency" value={brief.latencyDelta} hot />
        <HitlStat label="Started" value={formatTime(brief.startedAt)} />
      </dl>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-2">Root cause</div>
          <div className="text-[15px] font-medium">{brief.rootCause}</div>
          <div className="mt-1 mono text-[12px] text-muted">
            Confidence: {Math.round(brief.confidence * 100)}%
          </div>
          <p className="mt-3 max-w-xl text-[13px] leading-5 text-muted">{brief.rootCauseDetail}</p>
        </div>

        <div className="border-b border-line bg-panel p-4 lg:border-b-0">
          <div className="kicker mb-2">Recommended action</div>
          <div className="text-[15px] font-medium">{brief.recommended}</div>
          <dl className="mt-3 space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="text-muted">Expected recovery</span>
              <span>{brief.expectedRecovery}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Risk</span>
              <span className={riskTone(brief.risk)}>{brief.risk === "MEDIUM" ? "Medium" : brief.risk}</span>
            </div>
          </dl>
          {brief.awaiting && onApprove && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="border border-sev1 bg-sev1 px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-bg disabled:opacity-50"
                onClick={onApprove}
              >
                {busy ? "Working…" : brief.approveLabel}
              </button>
              {onReject && (
                <button
                  type="button"
                  disabled={busy}
                  className="border border-line px-3 py-2.5 text-[12px] text-muted hover:text-ink disabled:opacity-50"
                  onClick={onReject}
                >
                  Reject
                </button>
              )}
            </div>
          )}
          {!brief.awaiting && (
            <p className="mt-4 text-[12px] text-muted">
              Security Gateway {brief.actionType === "resolve" ? "has nothing pending." : "already licensed this change."}
            </p>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="kicker mb-3">Live timeline</div>
        <ol className="space-y-2">
          {brief.timeline.map((beat) => (
            <li key={`${beat.at}-${beat.title}`} className="flex gap-3 text-[13px]">
              <span className="mono w-20 text-[11px] text-faint">{formatTime(beat.at)}</span>
              <span>{beat.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HitlStat({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="border-b border-r border-line px-4 py-3 last:border-r-0 sm:border-b-0">
      <div className="kicker">{label}</div>
      <div className={`mt-1 text-[15px] ${hot ? "text-sev1" : ""}`}>{value}</div>
    </div>
  );
}
