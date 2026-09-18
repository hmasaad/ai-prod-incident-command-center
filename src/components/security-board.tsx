import { riskTone } from "@/lib/engine/remediate";
import type { PolicyApproval, SecuritySnapshot, SecurityVerdictKind } from "@/lib/types";

export function SecurityBoard({ security }: { security: SecuritySnapshot }) {
  const featured = security.catalog.filter((r) => r.featured);

  return (
    <section className="border-b border-line p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Security gateway · identity · policy · risk</span>
        <span className={`kicker ${security.execute ? "text-ok" : "text-sev2"}`}>
          Execute? {security.execute ? "yes" : "no"}
        </span>
      </div>

      <p className="text-[13px]">
        {security.question} <span className="text-muted">{security.answer}</span>
      </p>

      <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(160px,0.7fr)_minmax(0,1.6fr)_minmax(140px,0.55fr)]">
        <div className="border border-line bg-panel px-3 py-3">
          <div className="kicker">AI Incident Commander</div>
          <div className="mt-2 text-[13px]">Maya Chen · propose playbook</div>
          <p className="mt-1 text-[11px] text-muted">Agents recommend. They do not hold production credentials.</p>
        </div>
        <div className="border border-info bg-panel px-3 py-3">
          <div className="kicker">Security Gateway</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {security.layers
              .filter((l) => l.id === "identity" || l.id === "policy" || l.id === "risk")
              .map((layer) => (
                <div key={layer.id} className="border border-line px-2 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="kicker">{layer.title}</span>
                    <span className={`mono text-[10px] uppercase ${layerTone(layer.status)}`}>{layer.status}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted">{layer.summary}</p>
                </div>
              ))}
          </div>
        </div>
        <div className={`border px-3 py-3 ${security.execute ? "border-ok" : "border-sev2"}`}>
          <div className="kicker">Execute?</div>
          <div className={`mt-2 text-lg font-medium ${security.execute ? "text-ok" : "text-sev2"}`}>
            {security.execute ? "Yes" : "No"}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {security.execute ? "Licensed. MCP may run." : "Held. Controlled autonomy — not unrestricted prod access."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="kicker mb-2">Production policy</div>
          <ul className="space-y-1.5">
            {featured.map((rule) => (
              <li key={rule.id} className="border border-line px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="mono text-[12px]">{rule.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={`mono text-[10px] uppercase ${riskTone(rule.risk)}`}>{rule.risk}</span>
                    <span className={`kicker ${approvalTone(rule.approval)}`}>{rule.approval}</span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted">{rule.summary}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="kicker mb-2">MCP · agent runtime · AI API</div>
          <ul className="space-y-1.5">
            {security.mcp.slice(0, 4).map((tool) => (
              <li key={tool.tool} className="border border-line px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="mono text-[12px]">{tool.tool}</span>
                  <span className={`kicker ${approvalTone(tool.allow)}`}>{tool.allow}</span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted">{tool.detail}</p>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1">
            {security.runtime.map((g) => (
              <li key={g.id} className="text-[11px] text-muted">
                <span className="kicker mr-2 text-ok">{g.layer}</span>
                {g.title}
                <span className="text-faint"> — {g.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4">
        <div className="kicker mb-2">Agent probes · not executed</div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {security.probes.map((p) => (
            <li key={p.intent} className="flex items-center justify-between gap-2 border border-line px-2.5 py-1.5 text-[12px]">
              <span className="mono">{p.intent}</span>
              <span className={`kicker ${verdictTone(p.verdict)}`}>
                {p.verdict}
                {p.execute ? " · execute" : " · hold"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function layerTone(status: "pass" | "hold" | "fail") {
  if (status === "pass") return "text-ok";
  if (status === "hold") return "text-sev2";
  return "text-sev1";
}

function approvalTone(approval: PolicyApproval) {
  if (approval === "prohibited") return "text-sev1";
  if (approval === "required") return "text-sev2";
  return "text-ok";
}

function verdictTone(verdict: SecurityVerdictKind) {
  if (verdict === "allow") return "text-ok";
  if (verdict === "require_human") return "text-sev2";
  return "text-sev1";
}
