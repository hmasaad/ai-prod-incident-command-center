import { formatNumber } from "@/lib/format";
import type { BlastMark, BlastSurface, BlastVerdict } from "@/lib/types";

export function BlastBoard({
  blast,
  compact = false,
}: {
  blast: BlastVerdict;
  compact?: boolean;
}) {
  const affectedSvc = blast.services.filter((s) => s.mark === "affected");
  const quietSvc = blast.services.filter((s) => s.mark === "unaffected");
  const affectedReg = blast.regions.filter((r) => r.mark === "affected");
  const quietReg = blast.regions.filter((r) => r.mark === "unaffected");

  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Blast-radius agent · {blast.incidentId}</span>
        <span className="kicker">
          {formatNumber(blast.users)} {blast.segment.toLowerCase()}
          {blast.revenuePath ? " · revenue path" : ""}
        </span>
      </div>

      <p className="text-[13px]">
        {blast.question} <span className="text-muted">{blast.answer}</span>
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
        <div>
          <div className="kicker mb-2">Propagation</div>
          <ol className="border border-line bg-panel px-3 py-2">
            {blast.chain.map((hop, idx) => (
              <li key={hop.id} className="text-center">
                <div className="text-[13px] font-medium">{hop.title}</div>
                <div className="text-[11px] text-muted">{hop.detail}</div>
                {idx < blast.chain.length - 1 && (
                  <div className="mono py-1 text-[11px] text-faint">↓</div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SurfaceList title="Affected services" rows={affectedSvc} />
          <SurfaceList title="Unaffected services" rows={quietSvc} />
          <SurfaceList title="Affected regions" rows={affectedReg} />
          <SurfaceList title="Unaffected regions" rows={quietReg} />
        </div>
      </div>
    </section>
  );
}

function SurfaceList({ title, rows }: { title: string; rows: BlastSurface[] }) {
  return (
    <div>
      <div className="kicker mb-2">{title}</div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="border border-line px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px]">{row.name}</span>
              <Mark mark={row.mark} />
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted">{row.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mark({ mark }: { mark: BlastMark }) {
  const tone = mark === "affected" ? "text-sev1" : "text-ok";
  return <span className={`mono text-[10px] uppercase ${tone}`}>{mark === "affected" ? "affected" : "quiet"}</span>;
}
