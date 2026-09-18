import { riskTone } from "@/lib/engine/remediate";
import type { RemediationVerdict } from "@/lib/types";

const PIPELINE = [
  "AI recommendation",
  "Risk evaluation",
  "Policy engine",
  "Human approval",
  "Execution",
  "Verification",
] as const;

export function RemediationBoard({
  remediation,
  onApprove,
  onReject,
  busy = false,
}: {
  remediation: RemediationVerdict;
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
}) {
  const showButtons = Boolean(onApprove) && !remediation.approved && remediation.actionType !== "resolve";

  return (
    <section className="border-b border-line p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Remediation agent · {remediation.incidentId}</span>
        <span className="kicker">
          {remediation.approved
            ? "approved · executing"
            : remediation.rejected
              ? "rejected · not executed"
              : "human approval required · not auto-executed"}
        </span>
      </div>

      <p className="text-[13px]">
        {remediation.question} <span className="text-muted">{remediation.answer}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {PIPELINE.map((label, idx) => (
          <span key={label} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <span
              className={`border px-2 py-1 ${
                remediation.stages[idx]?.status === "active"
                  ? "border-info"
                  : remediation.stages[idx]?.status === "complete"
                    ? "border-ok/40 text-muted"
                    : "border-line text-muted"
              }`}
            >
              {label}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
        <dl className="border border-line bg-panel p-3 text-[13px]">
          <Row kicker="AI" value={remediation.recommendation} />
          <Row kicker="Risk" value={remediation.risk} valueClass={riskTone(remediation.risk)} />
          <Row kicker="Expected impact" value={remediation.expectedImpact} />
          <Row kicker="Policy" value={remediation.policy} />
          {showButtons && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="border border-sev1 bg-sev1 px-3 py-2 text-[12px] font-medium text-bg disabled:opacity-50"
                onClick={onApprove}
              >
                {busy ? "Working…" : remediation.approveLabel}
              </button>
              {onReject && (
                <button
                  type="button"
                  disabled={busy}
                  className="border border-line px-3 py-2 text-[12px] text-muted hover:text-ink disabled:opacity-50"
                  onClick={onReject}
                >
                  Reject
                </button>
              )}
            </div>
          )}
        </dl>

        <div>
          <div className="kicker mb-2">Catalog · evaluated, not auto-run</div>
          <ul className="space-y-1.5">
            {remediation.catalog.map((opt) => (
              <li key={opt.id} className={`border px-2.5 py-2 ${opt.selected ? "border-info bg-panel" : "border-line"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px]">
                    {opt.label}
                    {opt.selected ? <span className="kicker ml-2 text-info">selected</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`mono text-[10px] uppercase ${riskTone(opt.risk)}`}>{opt.risk}</span>
                    <span className="kicker">{opt.policyLabel}</span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted">{opt.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Row({
  kicker,
  value,
  valueClass = "",
}: {
  kicker: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="kicker mb-0.5">{kicker}</div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}
