import type { CommsAudience, CommsVerdict } from "@/lib/types";

const AUDIENCE_LABEL: Record<CommsAudience, string> = {
  engineers: "Engineers",
  management: "Management",
  customers: "Customers",
};

export function CommsBoard({ comms }: { comms: CommsVerdict }) {
  return (
    <section className="border-b border-line p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Communication agent · {comms.incidentId}</span>
        <span className="kicker">same incident · different communication</span>
      </div>
      <p className="text-[13px]">
        {comms.question} <span className="text-muted">{comms.answer}</span>
      </p>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {comms.updates.map((update) => (
          <article key={update.audience} className="border border-line bg-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">{AUDIENCE_LABEL[update.audience]}</span>
              <span className="kicker">{update.channel}</span>
            </div>
            <p className="mt-3 text-[13px] leading-5">{update.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
