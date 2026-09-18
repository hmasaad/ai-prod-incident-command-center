import { ConfidenceBar } from "./chrome";
import type { MemoryStage, MemoryVerdict } from "@/lib/types";

export function MemoryBoard({
  memory,
  compact = false,
}: {
  memory: MemoryVerdict;
  compact?: boolean;
}) {
  const selected = memory.hits.find((h) => h.id === memory.selectedId) ?? memory.hits[0];

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Incident memory · {memory.incidentId}</span>
        <span className="kicker">
          operational RAG · {memory.indexed} documents
          {selected ? ` · ${selected.id} ${Math.round(selected.score * 100)}%` : ""}
        </span>
      </div>

      <p className="text-[13px]">
        {memory.question} <span className="text-muted">{memory.answer}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {memory.stages.map((stage, idx) => (
          <span key={stage.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <StageChip stage={stage} />
          </span>
        ))}
      </div>

      {memory.query.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {memory.query.map((token) => (
            <span key={token} className="border border-line px-2 py-0.5 font-mono text-[10px] text-muted">
              {token.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Fact label="Previous RCA" value={memory.previousRca} />
          <Fact label="Previous remediation" value={memory.previousRemediation} />
          <Fact label="Previous outcome" value={memory.previousOutcome} />
        </div>
      )}

      {memory.hits.length > 0 && (
        <div className="mt-3 overflow-x-auto border border-line">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-panel">
                <th className="kicker px-3 py-2 font-normal">Incident</th>
                <th className="kicker w-[140px] px-3 py-2 font-normal">Similarity</th>
                <th className="kicker px-3 py-2 font-normal">When</th>
                <th className="kicker px-3 py-2 font-normal">Overlap</th>
              </tr>
            </thead>
            <tbody>
              {memory.hits.map((hit) => (
                <tr
                  key={hit.id}
                  className={`border-b border-line last:border-b-0 ${hit.id === memory.selectedId ? "bg-info/10" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="mono text-[11px]">{hit.id}</div>
                    <div>{hit.title}</div>
                    <div className="text-[11px] text-muted">{hit.patient}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="mono text-[11px]">{Math.round(hit.score * 100)}%</div>
                    <ConfidenceBar value={hit.score} />
                  </td>
                  <td className="px-3 py-2 text-muted">{hit.ago}</td>
                  <td className="px-3 py-2 text-muted">
                    {hit.overlap.map((t) => t.replaceAll("_", " ")).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line p-3">
      <div className="kicker mb-1">{label}</div>
      <p className="text-[13px] leading-5">{value}</p>
    </div>
  );
}

function StageChip({ stage }: { stage: MemoryStage }) {
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
