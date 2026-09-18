import type { AutonomyLoop, AutonomyNode, AutonomyReport } from "@/lib/types";

export function AutonomyBoard({
  report,
  compact = false,
}: {
  report: AutonomyReport;
  compact?: boolean;
}) {
  const live = report.loops.find((l) => l.incidentId === "INC-4821") ?? report.loops[0];
  const low = report.loops.find((l) => l.branch === "low_risk" && l.incidentId !== live?.incidentId);

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Autonomous commander</span>
        <span className="kicker">
          {live ? `${live.incidentId} · RCA ${Math.round(live.rcaConfidence * 100)}% · ${live.branch.replace("_", " ")}` : "idle"}
        </span>
      </div>

      <p className="text-[13px]">
        {report.question} <span className="text-muted">{report.answer}</span>
      </p>

      {live && <LoopDiagram loop={live} compact={compact} />}

      {!compact && low && (
        <div className="mt-4 border border-line p-3">
          <div className="kicker mb-1">Low-risk path already closed</div>
          <div className="text-[12px] font-medium">
            {low.incidentId} · {low.severity} · {low.summary}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Scale was automatic. The agent executed, verified, resolved, wrote the postmortem, and stored the incident in memory — no commander click.
          </p>
        </div>
      )}
    </section>
  );
}

function LoopDiagram({ loop, compact }: { loop: AutonomyLoop; compact: boolean }) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {loop.spine.map((node, idx) => (
          <span key={node.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <StageChip node={node} />
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ForkCard node={loop.low} tone="ok" />
        <ForkCard node={loop.high} tone="sev2" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {loop.tail.map((node, idx) => (
          <span key={node.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <StageChip node={node} />
          </span>
        ))}
      </div>

      {!compact && (
        <p className="mt-3 text-[11px] text-muted">{loop.summary}</p>
      )}
    </div>
  );
}

function ForkCard({ node, tone }: { node: AutonomyNode; tone: "ok" | "sev2" }) {
  const border =
    node.status === "skipped"
      ? "border-line"
      : node.status === "active"
        ? tone === "ok"
          ? "border-ok"
          : "border-sev2"
        : "border-line";
  return (
    <div className={`border px-3 py-2 ${border}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{node.label}</span>
        <span className={`mono text-[10px] uppercase ${statusTone(node)}`}>{node.status}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted">{node.detail}</p>
    </div>
  );
}

function StageChip({ node }: { node: AutonomyNode }) {
  const border =
    node.status === "active"
      ? "border-info"
      : node.status === "complete"
        ? "border-ok"
        : node.status === "skipped"
          ? "border-line"
          : "border-line";
  return (
    <span className={`border px-2 py-1 ${border}`}>
      <span className="text-[11px]">{node.label}</span>
      {node.id === "rca" && node.status !== "queued" ? (
        <span className="ml-1.5 mono text-[10px] text-muted">{node.detail.split(" · ")[0]}</span>
      ) : (
        <span className={`ml-1.5 mono text-[10px] uppercase ${statusTone(node)}`}>{node.status}</span>
      )}
    </span>
  );
}

function statusTone(node: AutonomyNode) {
  if (node.status === "complete") return "text-ok";
  if (node.status === "active") return "text-info";
  if (node.status === "skipped") return "text-faint";
  return "text-faint";
}
