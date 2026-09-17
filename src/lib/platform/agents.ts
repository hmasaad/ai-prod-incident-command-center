import { latestMetrics } from "../engine/detect";
import { buildPostmortem } from "../engine/postmortem";
import { recommend } from "../engine/recommend";
import { agentPhase, isClosed, latestCheckpoint } from "./machine";
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
    consumes: "Logs / Traces",
    run: (ctx) => {
      if (ctx.incident.status === "NEED_HUMAN_INPUT" || ctx.incident.status === "ESCALATED") {
        return {
          status: "blocked",
          summary: "Checkpointed. Confidence below 75% — will not re-run until human input.",
        };
      }
      const traces = ctx.analysis.evidence.filter((e) => e.source === "logs" || e.source === "git").length;
      return {
        status: "running",
        summary: `${traces} log/git signals. Pool timeouts on pg-payments-main; deploy a1f3c2d on the hot path.`,
      };
    },
  },
  {
    id: "communication",
    name: "Communication Agent",
    role: "Coordinate",
    consumes: "Slack / Teams",
    run: (ctx) => {
      const paged = ctx.incident.actions.some((a) => a.type === "page_oncall");
      const channel = ctx.incident.actions.some((a) => a.type === "open_channel");
      if (ctx.incident.status === "ESCALATED") {
        return { status: "complete", summary: "Next-level on-call paged. Waiting on human evidence to resume." };
      }
      if (channel && paged) {
        return { status: "complete", summary: "#inc-4821 open · Priya Nair acknowledged · Jordan drafting status." };
      }
      if (channel) {
        return { status: "complete", summary: "#inc-4821 open. Payments on-call not yet paged from this channel." };
      }
      if (paged) {
        return { status: "complete", summary: "Priya Nair paged. Slack war room still recommended." };
      }
      return {
        status: "running",
        summary: `${ctx.onCall.primary} commander · ${ctx.onCall.comms} comms. Channel #inc-4821 ready to open.`,
      };
    },
  },
  {
    id: "root-cause",
    name: "Root Cause Agent",
    role: "Cause",
    consumes: "Investigation graph",
    run: (ctx) => {
      const top = ctx.analysis.hypotheses[0];
      return {
        status: "running",
        summary: `${ctx.analysis.likelyCause} · ${(ctx.analysis.confidence * 100).toFixed(0)}% · ${top?.kind ?? "deploy"} hypothesis leads.`,
      };
    },
  },
  {
    id: "blast-radius",
    name: "Blast Radius Agent",
    role: "Impact",
    consumes: "Topology + RPS",
    run: (ctx) => {
      const blast = ctx.analysis.blastRadius;
      return {
        status: "running",
        summary: `~${blast.users.toLocaleString()} users · ${blast.services.join(", ")}${blast.revenuePath ? " · revenue path" : ""}.`,
      };
    },
  },
  {
    id: "remediation",
    name: "Remediation Agent",
    role: "Respond",
    consumes: "Playbooks",
    run: (ctx) => {
      const rec = recommend(ctx.incident, ctx.analysis);
      if (ctx.incident.status === "REMEDIATING" || ctx.incident.rollbackApplied) {
        return { status: "running", summary: "Change accepted. Spinnaker is the corrective path." };
      }
      if (ctx.incident.mitigationApplied && ctx.incident.status === "REMEDIATION_PENDING") {
        return {
          status: "blocked",
          summary: "Mitigation landed. Corrective action still waiting on commander.",
        };
      }
      return {
        status: "blocked",
        summary: `${rec.label}. Awaiting commander approval — not auto-executed.`,
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
    consumes: "Timeline",
    run: (ctx) => {
      if (!isClosed(ctx.incident.status)) {
        return { status: "idle", summary: "Queued. Compiles from checkpoints + timeline after RESOLVED." };
      }
      const pm = buildPostmortem(ctx.incident, ctx.now);
      return {
        status: ctx.incident.status === "POSTMORTEM" ? "complete" : "running",
        summary: `${pm.incidentId} · ${pm.durationMin} min · ${pm.actionItems.length} action items from the timeline.`,
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

    if (phase === "idle" || phase === "skipped") {
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

    if (phase === "complete" && spec.id !== "detection") {
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
