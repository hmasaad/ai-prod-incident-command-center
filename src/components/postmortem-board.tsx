import { formatNumber } from "@/lib/format";
import type { Postmortem, PostmortemStage } from "@/lib/types";

export function PostmortemBoard({
  postmortem,
  compact = false,
}: {
  postmortem: Postmortem;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Post-incident agent · {postmortem.incidentId}</span>
        <span className="kicker">
          {postmortem.ready ? "compiled from the record" : "queued until resolved"}
        </span>
      </div>

      <p className="text-[13px]">
        Once resolved: collect evidence → timeline → root cause → contributing factors → postmortem →
        corrective actions.{" "}
        <span className="text-muted">
          {postmortem.ready
            ? `${postmortem.title} · ${postmortem.durationMin} min · ${formatNumber(postmortem.customerImpact)} users.`
            : "The agent does not invent a write-up while the incident is still open."}
        </span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {postmortem.stages.map((stage, idx) => (
          <span key={stage.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <StageChip stage={stage} />
          </span>
        ))}
      </div>

      {postmortem.ready ? (
        <div className="mt-4">
          <PostmortemCard pm={postmortem} />
          {postmortem.contributing.length > 0 && (
            <div className="mt-3 border border-line p-3">
              <div className="kicker mb-2">Contributing factors</div>
              <ul className="space-y-1.5 text-[13px] text-muted">
                {postmortem.contributing.map((factor) => (
                  <li key={factor}>{factor}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function PostmortemCard({ pm }: { pm: Postmortem }) {
  const rows: { label: string; value: string }[] = [
    { label: "Incident", value: pm.title },
    { label: "Root Cause", value: pm.rootCauseLine },
    { label: "Detection", value: pm.detectionLine },
    { label: "Resolution", value: pm.resolution },
    { label: "Customer Impact", value: `${formatNumber(pm.customerImpact)} users` },
    { label: "Duration", value: `${pm.durationMin} minutes` },
  ];

  return (
    <article className="border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <span className="kicker">Postmortem</span>
      </div>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] gap-3 px-4 py-2.5">
            <dt className="kicker">{row.label}</dt>
            <dd className="text-[13px]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line px-4 py-3">
        <div className="kicker mb-2">Corrective Actions</div>
        <ul className="space-y-1.5 font-mono text-[13px]">
          {pm.actionItems.map((item) => (
            <li key={item.item} className="flex gap-2">
              <span className="text-muted">{item.done ? "[x]" : "[ ]"}</span>
              <span>{item.item}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function StageChip({ stage }: { stage: PostmortemStage }) {
  const tone =
    stage.status === "complete"
      ? "border-ok text-ok"
      : stage.status === "active"
        ? "border-info text-ink"
        : "border-line text-muted";
  return (
    <span className={`border px-2 py-1 ${tone}`}>
      {stage.label}
      <span className="ml-1.5 mono text-[10px] uppercase text-faint">{stage.status}</span>
    </span>
  );
}
