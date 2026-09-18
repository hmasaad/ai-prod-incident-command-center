import type { AgentRun, AgentRunStatus, PipelineSnapshot } from "@/lib/types";
import { formatTime } from "@/lib/format";

const WAVE1: AgentRun["id"][] = ["detection", "investigation", "communication", "memory"];
const WAVE2: AgentRun["id"][] = [
  "root-cause",
  "blast-radius",
  "remediation",
  "verification",
  "postmortem",
];

export function PipelineBoard({
  pipeline,
  compact = false,
}: {
  pipeline: PipelineSnapshot;
  compact?: boolean;
}) {
  const byId = Object.fromEntries(pipeline.agents.map((a) => [a.id, a]));

  return (
    <section className={compact ? "p-4" : "border-b border-line p-4"}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="kicker">Platform pipeline · {pipeline.incidentId}</span>
        <span className="kicker">active · {pipeline.activeStage}</span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <Node
          kicker="Ingress"
          title={pipeline.gateway.title}
          summary={pipeline.gateway.summary}
          status="complete"
        />
        <Node
          kicker="Control plane"
          title={pipeline.orchestrator.title}
          summary={pipeline.orchestrator.summary}
          status="running"
        />
      </div>

      {pipeline.security && (
        <div className="mt-2 border border-line px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="kicker">Egress · Security Gateway</span>
            <span className={`mono text-[10px] uppercase ${pipeline.security.execute ? "text-ok" : "text-sev2"}`}>
              Execute? {pipeline.security.execute ? "yes" : "no"}
            </span>
          </div>
          <div className="mt-1 text-[12px] font-medium">{pipeline.security.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-muted">{pipeline.security.answer}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pipeline.security.layers
              .filter((l) => l.id === "identity" || l.id === "policy" || l.id === "risk")
              .map((l) => (
                <span key={l.id} className="border border-line px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                  {l.title}
                  <span className="ml-1 text-faint">{l.status}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="kicker mb-2 mt-4">Wave 1 · parallel</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {WAVE1.map((id) => (
          <AgentNode key={id} agent={byId[id]} active={pipeline.activeStage === id} />
        ))}
      </div>

      <div className="kicker mb-2 mt-4">Wave 2 · serial</div>
      <div className="grid gap-2 sm:grid-cols-5">
        {WAVE2.map((id) => (
          <AgentNode key={id} agent={byId[id]} active={pipeline.activeStage === id} />
        ))}
      </div>

      {!compact && (
        <>
          <div className="kicker mb-2 mt-4">Gateway ingest</div>
          <ul className="space-y-1.5">
            {pipeline.ingest.slice(0, 5).map((ev) => (
              <li key={ev.id} className="flex gap-2 text-[12px]">
                <span className="mono text-[10px] text-faint">{formatTime(ev.ts)}</span>
                <span className="mono text-[10px] text-muted">{ev.source}</span>
                <span>
                  {ev.title}
                  <span className="text-muted"> · {ev.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AgentNode({ agent, active }: { agent?: AgentRun; active: boolean }) {
  if (!agent) return null;
  return (
    <Node
      kicker={agent.consumes}
      title={agent.name}
      summary={agent.summary}
      status={agent.status}
      active={active}
    />
  );
}

function Node({
  kicker,
  title,
  summary,
  status,
  active = false,
}: {
  kicker: string;
  title: string;
  summary: string;
  status: AgentRunStatus | "complete" | "running";
  active?: boolean;
}) {
  return (
    <div className={`border px-3 py-2 ${active ? "border-info" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{kicker}</span>
        <StatusChip status={status} />
      </div>
      <div className="mt-1 text-[12px] font-medium">{title}</div>
      <p className="mt-1 text-[11px] leading-4 text-muted">{summary}</p>
    </div>
  );
}

function StatusChip({ status }: { status: AgentRunStatus | "complete" | "running" }) {
  const tone =
    status === "complete"
      ? "text-ok"
      : status === "running"
        ? "text-info"
        : status === "blocked"
          ? "text-sev2"
          : status === "skipped"
            ? "text-sev3"
            : "text-faint";
  return <span className={`mono text-[10px] uppercase ${tone}`}>{status}</span>;
}
