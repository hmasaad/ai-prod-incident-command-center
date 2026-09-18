import { formatTime } from "@/lib/format";
import type { Investigation } from "@/lib/types";

export function InvestigationBoard({
  investigation,
  incidentId,
}: {
  investigation: Investigation;
  incidentId: string;
}) {
  const beats = investigation.beats ?? [];
  const chain = investigation.causalChain ?? [];

  return (
    <section className="border-b border-line p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Investigation agent · {incidentId}</span>
        <span className="kicker">
          {beats.length} beats · {chain.length}-step chain · {(investigation.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mb-3 max-w-3xl text-[13px] text-muted">{investigation.summary}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="kicker mb-2">Investigation timeline</div>
          <ol>
            {beats.map((beat, idx) => (
              <li key={beat.id} className="relative pl-4">
                {idx < beats.length - 1 && (
                  <span className="absolute bottom-0 left-[5px] top-4 w-px bg-line-2" />
                )}
                <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border border-info bg-bg" />
                <div className="pb-4">
                  <div className="mono text-[10px] text-faint">
                    {formatTime(beat.at)} · {beat.source}
                  </div>
                  <div className="text-[13px]">{beat.title}</div>
                  <div className="text-[12px] text-muted">{beat.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <div className="kicker mb-2">Most likely causal chain</div>
          <ol className="border border-line bg-panel px-3 py-2">
            {chain.map((step, idx) => (
              <li key={step.id} className="text-center">
                <div className="text-[13px] font-medium">{step.title}</div>
                <div className="text-[11px] text-muted">{step.detail}</div>
                {idx < chain.length - 1 && (
                  <div className="mono py-1 text-[11px] text-faint">↓</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
