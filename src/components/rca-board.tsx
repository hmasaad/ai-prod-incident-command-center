import { ConfidenceBar } from "./chrome";
import type { RcaCandidate, RcaStance, RcaVerdict } from "@/lib/types";

const FUNNEL = [
  "Recent deployments",
  "Logs",
  "Metrics",
  "Traces",
  "Git commits",
  "Infrastructure events",
] as const;

export function RcaBoard({
  rca,
  compact = false,
}: {
  rca: RcaVerdict;
  compact?: boolean;
}) {
  const present = rca.evidencePack.filter((e) => e.present).length;
  const top = rca.candidates.find((c) => c.id === rca.selectedId) ?? rca.candidates[0];

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">RCA agent · {rca.incidentId}</span>
        <span className="kicker">
          engine-bound · {present}/6 families · {top ? `${Math.round(top.probability * 100)}% ${top.candidate}` : "no candidate"}
        </span>
      </div>

      <p className="text-[13px]">
        {rca.question} <span className="text-muted">{rca.answer}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {FUNNEL.map((label, idx) => (
          <span key={label} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">+</span>}
            <span className="border border-line px-2 py-1 text-muted">{label}</span>
          </span>
        ))}
        <span className="mono px-1 text-[11px] text-faint">↓</span>
        <span className="border border-info px-2 py-1 text-[11px]">RCA Engine</span>
        <span className="mono px-1 text-[11px] text-faint">↓</span>
        <span className="border border-line px-2 py-1 text-[11px] text-muted">Candidate causes</span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.85fr)]">
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-panel">
                <th className="kicker px-3 py-2 font-normal">Candidate</th>
                <th className="kicker w-[140px] px-3 py-2 font-normal">Probability</th>
                <th className="kicker px-3 py-2 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rca.candidates.map((row) => (
                <CandidateRow key={row.id} row={row} selected={row.id === rca.selectedId} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {rca.evidencePack.map((item) => (
            <div key={item.family} className="border border-line px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="kicker">{item.label}</span>
                <span className={`mono text-[10px] uppercase ${item.present ? "text-ok" : "text-faint"}`}>
                  {item.present ? "in pack" : "empty"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted">{item.fact}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-[12px] leading-5 text-muted">{rca.narration}</p>

      {rca.vetoed.length > 0 && (
        <div className="mt-3">
          <div className="kicker mb-1.5">Vetoed — LLM may not invent these</div>
          <ul className="space-y-1">
            {rca.vetoed.map((v) => (
              <li key={v.claim} className="text-[12px]">
                <span className="text-ink">{v.claim}</span>
                <span className="text-muted"> — {v.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CandidateRow({ row, selected }: { row: RcaCandidate; selected: boolean }) {
  return (
    <tr className={`border-b border-line last:border-b-0 ${selected ? "bg-panel" : ""}`}>
      <td className="px-3 py-2">
        <div className="font-medium">{row.candidate}</div>
        <div className={`kicker mt-0.5 ${stanceClass(row.stance)}`}>{row.stance}</div>
      </td>
      <td className="px-3 py-2">
        <ConfidenceBar value={row.probability} />
      </td>
      <td className="px-3 py-2 text-muted">{row.evidence}</td>
    </tr>
  );
}

function stanceClass(stance: RcaStance) {
  if (stance === "supported") return "text-ok";
  if (stance === "contributing") return "text-sev2";
  return "text-faint";
}
