import { FAILURE_PATH, HAPPY_PATH } from "@/lib/platform/machine";
import { formatTime, statusLabel } from "@/lib/format";
import type { Incident, IncidentStatus } from "@/lib/types";

export function StateMachineBoard({
  incident,
  compact = false,
}: {
  incident: Incident;
  compact?: boolean;
}) {
  const current = incident.machine?.state ?? incident.status;
  const checkpoints = incident.machine?.checkpoints ?? [];
  const onFailure = FAILURE_PATH.includes(current);

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="kicker">Incident state machine · {incident.id}</span>
        <span className="kicker">
          {onFailure ? "failure path" : "happy path"} · {statusLabel(current)}
        </span>
      </div>

      <ol className="flex flex-wrap items-center gap-1.5">
        {HAPPY_PATH.map((state, idx) => (
          <li key={state} className="flex items-center gap-1.5">
            {idx > 0 && <span className="text-[10px] text-faint">→</span>}
            <StateChip state={state} current={current} />
          </li>
        ))}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <span className="kicker">failure</span>
        <span className="text-faint">INVESTIGATING</span>
        <span className="text-[10px] text-faint">insufficient data</span>
        <span className="text-[10px] text-faint">→</span>
        {FAILURE_PATH.map((state, idx) => (
          <span key={state} className="flex items-center gap-1.5">
            {idx > 0 && <span className="text-[10px] text-faint">→</span>}
            <StateChip state={state} current={current} />
          </span>
        ))}
      </div>

      {!compact && (
        <ol className="mt-3 space-y-1.5">
          {[...checkpoints].slice(-5).reverse().map((cp) => (
            <li key={cp.id} className="text-[12px]">
              <span className="mono text-[10px] text-faint">
                {formatTime(cp.at)} · {cp.id}
                {cp.agentId ? ` · ${cp.agentId}` : ""}
              </span>
              <div>
                {statusLabel(cp.state)}
                <span className="text-muted"> · {cp.note}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StateChip({ state, current }: { state: IncidentStatus; current: IncidentStatus }) {
  const active = state === current;
  const tone = active
    ? state === "NEED_HUMAN_INPUT" || state === "ESCALATED"
      ? "border-sev2 bg-sev2/10 text-sev2"
      : state === "RESOLVED" || state === "POSTMORTEM"
        ? "border-ok bg-ok/10 text-ok"
        : "border-info bg-info/10 text-info"
    : "border-line text-faint";
  return (
    <span className={`mono border px-1.5 py-0.5 text-[9px] tracking-wide ${tone}`}>
      {state}
    </span>
  );
}
