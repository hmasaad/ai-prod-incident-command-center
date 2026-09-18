import { latestMetrics } from "../engine/detect";
import { agentPhase, latestCheckpoint } from "./machine";
import type { AgentId, AgentRun } from "../types";
import type { AgentContext, AgentOutput } from "./context";

interface Spec {
  id: AgentId;
  name: string;
  role: string;
  consumes: string;
  run: (ctx: AgentContext) => AgentOutput;
}

function lastError(ctx: AgentContext) {
  return latestMetrics(ctx.metrics).errorRate;
}

const specs: Spec[] = [
  {
    id: "detection",
    name: "Detection Agent",
    role: "Detect",
    consumes: "Alerts · Logs · Errors · Infra · Deploy · DB · Cloud",
    run: (ctx) => {
      const d = ctx.detection;
      const firing = d.signals.filter((s) => s.firing).length;
      const summary = `${d.verdict === "incident" ? "Incident" : "Noisy alert"} · ${d.severity} · ${(d.confidence * 100).toFixed(0)}% · ${d.affected.join(", ")} · ${firing}/7 families firing`;
      if (d.verdict === "noisy") {
        return { status: "running", summary };
      }
      return { status: "complete", summary };
    },
  },
  {
    id: "investigation",
    name: "Investigation Agent",
    role: "Investigate",
    consumes: "Timeline · Metrics · Logs · Git · Comms",
    run: (ctx) => {
      if (ctx.incident.status === "NEED_HUMAN_INPUT" || ctx.incident.status === "ESCALATED") {
        return {
          status: "blocked",
          summary: "Checkpointed. Causal chain incomplete — will not re-run until human input.",
        };
      }
      const chain = ctx.analysis.causalChain;
      const beats = ctx.analysis.beats;
      return {
        status: "complete",
        summary: `${beats.length}-beat timeline · ${chain.length}-step chain · ${chain[0]?.title ?? "cause"} → ${chain.at(-1)?.title ?? "impact"} · ${(ctx.analysis.confidence * 100).toFixed(0)}%`,
      };
    },
  },
  {
    id: "communication",
    name: "Communication Agent",
    role: "Coordinate",
    consumes: "Slack · Exec · Status page",
    run: (ctx) => {
      const updates = ctx.comms.updates;
      const summary = updates.map((u) => u.audience).join(" · ");
      if (ctx.incident.status === "ESCALATED") {
        return { status: "complete", summary: `${summary}. Escalation copy live. Still three audiences.` };
      }
      return {
        status: "complete",
        summary: `${updates.length} audiences · ${summary} — same incident, different communication.`,
      };
    },
  },
  {
    id: "memory",
    name: "Memory Agent",
    role: "Recall",
    consumes: "Closed incidents · RCA · Playbooks · Outcomes",
    run: (ctx) => {
      const mem = ctx.memory;
      const top = mem.hits[0];
      if (!top) {
        return { status: "running", summary: `${mem.indexed} documents · no similar incident retrieved.` };
      }
      return {
        status: "complete",
        summary: `${top.id} ${Math.round(top.score * 100)}% · ${mem.indexed} documents · ${top.rca}`,
      };
    },
  },
  {
    id: "root-cause",
    name: "Root Cause Agent",
    role: "Cause",
    consumes: "Deploys · Logs · Metrics · Traces · Git · Infra",
    run: (ctx) => {
      const rca = ctx.rca;
      const top = rca.candidates.find((c) => c.id === rca.selectedId) ?? rca.candidates[0];
      const disconfirmed = rca.candidates.filter((c) => c.stance === "disconfirmed").length;
      const present = rca.evidencePack.filter((e) => e.present).length;
      if (rca.confidence < 0.75) {
        return {
          status: "blocked",
          summary: `Engine will not name a cause. ${top?.candidate ?? "top"} ${Math.round(rca.confidence * 100)}% · ${present}/6 families · below 75% gate.`,
        };
      }
      return {
        status: "complete",
        summary: `${top?.candidate ?? rca.incidentId} ${Math.round((top?.probability ?? rca.confidence) * 100)}% · ${rca.candidates.length} candidates · ${disconfirmed} disconfirmed · engine-bound`,
      };
    },
  },
  {
    id: "blast-radius",
    name: "Blast Radius Agent",
    role: "Impact",
    consumes: "Topology · RPS · Regions · Clients",
    run: (ctx) => {
      const b = ctx.blast;
      const affected = b.services.filter((s) => s.mark === "affected").map((s) => s.name);
      const quiet = b.services.filter((s) => s.mark === "unaffected").length;
      const regions = b.regions.filter((r) => r.mark === "affected").map((r) => r.name);
      return {
        status: "complete",
        summary: `${b.users.toLocaleString()} ${b.segment.toLowerCase()} · ${affected.join(" + ")} · ${regions.join(", ")} · ${quiet} surfaces quiet`,
      };
    },
  },
  {
    id: "remediation",
    name: "Remediation Agent",
    role: "Respond",
    consumes: "Playbooks · Policy · Human gate",
    run: (ctx) => {
      const r = ctx.remediation;
      if (r.approved) {
        return {
          status: ctx.incident.status === "REMEDIATING" ? "running" : "complete",
          summary:
            ctx.incident.severity === "SEV-1"
              ? `${r.recommendation} approved · ${r.risk} · executing — agent did not auto-run.`
              : `${r.recommendation} · ${r.risk} · executing — policy automatic.`,
        };
      }
      if (r.rejected) {
        return {
          status: "blocked",
          summary: `${r.recommendation} rejected · ${r.risk} · still blocked — will not execute.`,
        };
      }
      return {
        status: "blocked",
        summary: `${r.recommendation} · ${r.risk} · ${r.policy.toLowerCase()} — not auto-executed.`,
      };
    },
  },
  {
    id: "verification",
    name: "Verification Agent",
    role: "Verify",
    consumes: "Recovery metrics",
    run: (ctx) => {
      const err = lastError(ctx);
      if (ctx.incident.status !== "VERIFYING") {
        return { status: "idle", summary: "Idle until the machine enters VERIFYING." };
      }
      if (err >= 3) {
        return { status: "running", summary: `Watching recovery · error rate still ${err.toFixed(1)}%.` };
      }
      return { status: "complete", summary: `Error rate ${err.toFixed(1)}% — back under baseline. Auth collateral clearing.` };
    },
  },
  {
    id: "postmortem",
    name: "Postmortem Agent",
    role: "Learn",
    consumes: "Evidence · Timeline · RCA · Actions",
    run: (ctx) => {
      const pm = ctx.postmortem;
      if (!pm.ready) {
        return { status: "idle", summary: "Queued. Collect evidence → timeline → cause → contributing → postmortem → actions after RESOLVED." };
      }
      return {
        status: ctx.incident.status === "POSTMORTEM" ? "complete" : "running",
        summary: `${pm.title} · ${pm.durationMin} min · ${pm.customerImpact.toLocaleString()} users · ${pm.actionItems.length} corrective actions.`,
      };
    },
  },
];

/** Agents resume from the incident machine checkpoint instead of re-running from scratch. */
export function runAgents(ctx: AgentContext): AgentRun[] {
  const state = ctx.incident.machine?.state ?? ctx.incident.status;
  return specs.map((spec) => {
    const phase = agentPhase(state, spec.id);
    const checkpoint = latestCheckpoint(ctx.incident.machine, spec.id);

    if ((phase === "idle" || phase === "skipped") && spec.id !== "postmortem") {
      return {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        consumes: spec.consumes,
        status: phase,
        summary: checkpoint
          ? `Parked. Last checkpoint ${checkpoint.id}: ${checkpoint.note}`
          : "Idle until the incident machine reaches this agent's state.",
      };
    }

    if (phase === "complete" && spec.id !== "detection" && spec.id !== "investigation" && spec.id !== "communication" && spec.id !== "memory" && spec.id !== "root-cause" && spec.id !== "blast-radius" && spec.id !== "remediation" && spec.id !== "postmortem") {
      return {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        consumes: spec.consumes,
        status: "complete",
        summary: checkpoint
          ? `Resumed from ${checkpoint.id} · ${checkpoint.note}`
          : spec.run(ctx).summary,
      };
    }

    const out = spec.run(ctx);
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      consumes: spec.consumes,
      status: phase === "blocked" ? "blocked" : out.status,
      summary: out.summary,
    };
  });
}

export function activeStage(agents: AgentRun[]): AgentId | "orchestrator" {
  const order: AgentId[] = [
    "detection",
    "investigation",
    "communication",
    "memory",
    "root-cause",
    "blast-radius",
    "remediation",
    "verification",
    "postmortem",
  ];
  const blocked = agents.find((a) => a.status === "blocked" || a.status === "running");
  if (blocked) return blocked.id;
  const idle = [...order].reverse().find((id) => agents.find((a) => a.id === id)?.status === "idle");
  if (idle) return idle;
  return "postmortem";
}
