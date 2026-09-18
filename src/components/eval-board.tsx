import { formatDuration } from "@/lib/format";
import type { EvalFamily, EvalMetric, EvalReport } from "@/lib/types";

const FAMILY_LABEL: Record<EvalFamily, string> = {
  detection: "Detection",
  rca: "RCA",
  remediation: "Remediation",
  agent: "Agent behavior",
};

export function EvalBoard({
  report,
  compact = false,
  onRerun,
  busy = false,
}: {
  report: EvalReport;
  compact?: boolean;
  onRerun?: () => void;
  busy?: boolean;
}) {
  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Evals · synthetic incidents</span>
        <span className="kicker">
          {report.passed}/{report.cases} cases · {report.fixtures} fixtures · {(report.score * 100).toFixed(0)}%
        </span>
      </div>

      <p className="text-[13px]">
        Measure the commander against ground truth.{" "}
        <span className="text-muted">
          Detection, RCA, remediation, and agent behavior — not an LLM asked if it did a good job.
        </span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {report.stages.map((stage, idx) => (
          <span key={stage.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <span className="border border-ok px-2 py-1 text-ok">
              {stage.label}
              <span className="ml-1.5 mono text-[10px] uppercase text-faint">{stage.status}</span>
            </span>
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {report.groups.map((group) => (
          <div key={group.id} className="border border-line p-3">
            <div className="kicker mb-2">{FAMILY_LABEL[group.id]}</div>
            <ul className="space-y-2">
              {group.metrics.map((metric) => (
                <li key={metric.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px]">{metric.label}</span>
                    <span className={`mono text-[12px] ${tone(metric)}`}>{formatMetric(metric)}</span>
                  </div>
                  {metric.unit === "rate" && (
                    <div className="mt-1 h-1 bg-line">
                      <div
                        className={`h-1 ${bar(metric)}`}
                        style={{ width: `${Math.min(100, Math.round(displayRate(metric) * 100))}%` }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="mt-4 overflow-x-auto border border-line">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-panel">
                <th className="kicker px-3 py-2 font-normal">Case</th>
                <th className="kicker px-3 py-2 font-normal">Fixture</th>
                <th className="kicker px-3 py-2 font-normal">Expected</th>
                <th className="kicker px-3 py-2 font-normal">Observed</th>
                <th className="kicker w-16 px-3 py-2 font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.flatMap((g) => g.cases).map((row) => (
                <tr key={row.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2">
                    <div>{row.title}</div>
                    <div className="text-[11px] text-muted">{row.detail}</div>
                  </td>
                  <td className="mono px-3 py-2 text-[11px]">{row.fixture}</td>
                  <td className="px-3 py-2 text-muted">{row.expected}</td>
                  <td className="px-3 py-2 text-muted">{row.observed}</td>
                  <td className={`px-3 py-2 mono text-[11px] uppercase ${row.pass ? "text-ok" : "text-sev1"}`}>
                    {row.pass ? "pass" : "fail"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onRerun && (
        <button
          type="button"
          disabled={busy}
          className="mt-3 border border-line px-3 py-1.5 text-[11px] text-muted hover:text-ink disabled:opacity-50"
          onClick={onRerun}
        >
          {busy ? "Running…" : "Re-run evals"}
        </button>
      )}
    </section>
  );
}

function formatMetric(metric: EvalMetric) {
  if (metric.unit === "ms") return formatDuration(metric.value);
  return `${Math.round(metric.value * 100)}%`;
}

function displayRate(metric: EvalMetric) {
  const invert =
    metric.id === "false_positive_rate" ||
    metric.id === "false_attribution_rate" ||
    metric.id === "unsafe_action_rate" ||
    metric.id === "hallucination_rate" ||
    metric.id === "tool_misuse" ||
    metric.id === "policy_violations" ||
    metric.id === "unauthorized_actions";
  return invert ? 1 - metric.value : metric.value;
}

function tone(metric: EvalMetric) {
  const good = metric.unit === "ms" ? metric.value > 0 && metric.passed === metric.n : displayRate(metric) >= 0.85;
  return good ? "text-ok" : "text-sev1";
}

function bar(metric: EvalMetric) {
  return displayRate(metric) >= 0.85 ? "bg-ok" : "bg-sev1";
}
